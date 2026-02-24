import { Request, Response, NextFunction } from 'express';
import { HealthService } from '../../services/health/HealthService';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** GET /health — full readiness check (storage connectivity etc.) */
  ready = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = await this.healthService.check();
      const httpStatus = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;
      res.status(httpStatus).json({ data: status });
    } catch (err) {
      next(err);
    }
  };

  /** GET /health/live — simple liveness ping (no I/O) */
  live = (_req: Request, res: Response): void => {
    res.json({ data: this.healthService.live() });
  };
}
