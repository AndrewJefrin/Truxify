import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let authUser = { id: 'test-user', role: 'customer' };
let policyAllowed = true;

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    if (!authUser) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    req.user = authUser;
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: (action) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated: req.user is missing.' });
    }
    if (!policyAllowed) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
    }
    next();
  },
}));

const { mockOsrm } = vi.hoisted(() => ({
  mockOsrm: {
    getRouteGeometry: vi.fn(),
  },
}));

vi.mock('../../src/services/osrm.js', () => mockOsrm);

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import routeRoutes from '../../src/routes/routeRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/routes', routeRoutes);
  return app;
}

describe('routeRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: 'test-user', role: 'customer' };
    policyAllowed = true;
    mockOsrm.getRouteGeometry.mockResolvedValue({
      type: 'Feature',
      properties: {
        distanceKm: 12.5,
        durationSeconds: 900,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [80.2707, 13.0827],
          [80.2707, 13.0827],
        ],
      },
    });
  });

  describe('POST /routes/plan', () => {
    it('returns 400 when body is missing origin and destination', async () => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Both origin and destination are required for route planning.');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 400 when origin is missing', async () => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ destination: 'Bangalore' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Both origin and destination are required for route planning.');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 400 when destination is missing', async () => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Both origin and destination are required for route planning.');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 400 when origin or destination is empty string', async () => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: '', destination: 'Bangalore' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Both origin and destination are required for route planning.');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it.each(['', '   '])('returns 400 when routeId is blank string', async (routeId) => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai', destination: 'Bangalore', routeId });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid routeId provided.');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 422 when geocoding fails for origin address', async () => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'unknown place', destination: 'Bangalore' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to geocode origin address: unknown place');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 422 when geocoding fails for destination address', async () => {
      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai', destination: 'invalid location' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to geocode destination address: invalid location');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 502 when OSRM routing provider returns no results', async () => {
      mockOsrm.getRouteGeometry.mockResolvedValue(null);

      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai', destination: 'Bangalore' });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Failed to calculate route from routing provider.');
    });

    it('returns 200 with route details on successful planning', async () => {
      const mockRouteFeature = {
        type: 'Feature',
        properties: {
          distanceKm: 12.5,
          durationSeconds: 900,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [80.2707, 13.0827],
            [80.2707, 13.0827],
          ],
        },
      };
      mockOsrm.getRouteGeometry.mockResolvedValue(mockRouteFeature);

      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai Central', destination: 'Bangalore City' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        origin: { lat: 13.0827, lng: 80.2707 },
        destination: { lat: 13.0827, lng: 80.2707 },
        route: mockRouteFeature,
      });

      expect(mockOsrm.getRouteGeometry).toHaveBeenCalledWith({
        originLat: 13.0827,
        originLng: 80.2707,
        destLat: 13.0827,
        destLng: 80.2707,
      });
    });

    it('returns 500 when an unhandled exception occurs during routing', async () => {
      mockOsrm.getRouteGeometry.mockRejectedValue(new Error('Connection error'));

      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai', destination: 'Bangalore' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Internal server error while planning route.');
    });

    it('returns 401 when user is not authenticated', async () => {
      authUser = null;

      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai', destination: 'Bangalore' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('User not authenticated');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });

    it('returns 403 when user fails policy check', async () => {
      policyAllowed = false;

      const res = await request(makeApp())
        .post('/routes/plan')
        .send({ origin: 'Chennai', destination: 'Bangalore' });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Insufficient privileges.');
      expect(mockOsrm.getRouteGeometry).not.toHaveBeenCalled();
    });
  });
});
