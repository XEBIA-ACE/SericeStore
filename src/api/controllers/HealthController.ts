import { Response } from 'express';
import { register } from '../../utils/metrics';
import { AppRequest, ApiResponse } from '../../core/types';
import { config } from '../../config';

/**
 * Health and observability endpoints.
 */
export class HealthController {
  /**
   * GET /health
   * Returns a simple liveness check — if the process is running, it's alive.
   */
  liveness(_req: AppRequest, res: Response): void {
    res.status(200).json({
      success: true,
      data: { status: 'ok', timestamp: new Date().toISOString() },
    } satisfies ApiResponse);
  }

  /**
   * GET /health/ready
   * Readiness check.  In a real service you would ping the storage backend
   * and any other critical dependencies here.
   */
  readiness(_req: AppRequest, res: Response): void {
    res.status(200).json({
      success: true,
      data: {
        status: 'ok',
        provider: config.STORAGE_PROVIDER,
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse);
  }

  /**
   * GET /metrics
   * Expose Prometheus metrics.
   */
  async metrics(_req: AppRequest, res: Response): Promise<void> {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  }
}
