import { Router, Request, Response } from 'express';
import {
  RideService,
  RideConflictError,
  InvalidOtpError,
  RideNotFoundError,
  InvalidStateTransitionError,
} from './ride.service.js';
import { CreateRideRequestSchema } from './types.js';

function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || '';
  return param || '';
}

export function createRideRouter(rideService: RideService): Router {
  const router = Router();

  // 1. POST /rides/request
  router.post('/request', async (req: Request, res: Response) => {
    try {
      const parsed = CreateRideRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
      }

      const ride = await rideService.requestRide(parsed.data);
      return res.status(201).json(ride);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 2. POST /rides/:id/accept
  router.post('/:id/accept', async (req: Request, res: Response) => {
    try {
      const { driverId } = req.body;
      if (!driverId || typeof driverId !== 'string') {
        return res.status(400).json({ error: 'driverId is required' });
      }

      const ride = await rideService.acceptRide(getParamId(req.params.id), driverId);
      return res.status(200).json(ride);
    } catch (err: any) {
      if (err instanceof RideNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof RideConflictError || err instanceof InvalidStateTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 3. POST /rides/:id/reject
  router.post('/:id/reject', async (req: Request, res: Response) => {
    try {
      const { driverId } = req.body;
      if (!driverId || typeof driverId !== 'string') {
        return res.status(400).json({ error: 'driverId is required' });
      }

      await rideService.rejectRide(getParamId(req.params.id), driverId);
      return res.status(200).json({ success: true, message: 'Offer rejected, iterating to next candidate' });
    } catch (err: any) {
      if (err instanceof RideNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 4. POST /rides/:id/arrived
  router.post('/:id/arrived', async (req: Request, res: Response) => {
    try {
      const { driverId } = req.body;
      if (!driverId) {
        return res.status(400).json({ error: 'driverId is required' });
      }

      const ride = await rideService.driverArrived(getParamId(req.params.id), driverId);
      return res.status(200).json(ride);
    } catch (err: any) {
      if (err instanceof RideNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof RideConflictError || err instanceof InvalidStateTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 5. POST /rides/:id/start
  router.post('/:id/start', async (req: Request, res: Response) => {
    try {
      const { driverId, otp } = req.body;
      if (!driverId || !otp) {
        return res.status(400).json({ error: 'driverId and otp are required' });
      }

      const ride = await rideService.startTrip(getParamId(req.params.id), driverId, otp);
      return res.status(200).json(ride);
    } catch (err: any) {
      if (err instanceof InvalidOtpError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof RideNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof RideConflictError || err instanceof InvalidStateTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 6. POST /rides/:id/complete
  router.post('/:id/complete', async (req: Request, res: Response) => {
    try {
      const { driverId } = req.body;
      if (!driverId) {
        return res.status(400).json({ error: 'driverId is required' });
      }

      const ride = await rideService.completeTrip(getParamId(req.params.id), driverId);
      return res.status(200).json(ride);
    } catch (err: any) {
      if (err instanceof RideNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof RideConflictError || err instanceof InvalidStateTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 7. POST /rides/:id/cancel
  router.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
      const { cancelledBy, reason } = req.body;
      const validActor = cancelledBy === 'DRIVER' ? 'DRIVER' : 'RIDER';

      const ride = await rideService.cancelRide(getParamId(req.params.id), validActor, reason);
      return res.status(200).json(ride);
    } catch (err: any) {
      if (err instanceof RideNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof InvalidStateTransitionError) {
        return res.status(409).json({ error: err.message });
      }
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  // 8. GET /rides/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const ride = await rideService.getRideById(getParamId(req.params.id));
      if (!ride) {
        return res.status(404).json({ error: 'Ride not found' });
      }
      return res.status(200).json(ride);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
  });

  return router;
}
