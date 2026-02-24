import { Router } from 'express';
import { HealthController } from '../controllers/HealthController';
import { MetricsController } from '../controllers/MetricsController';

export function healthRoutes(
  healthController: HealthController,
  metricsController: MetricsController,
): Router {
  const router = Router();

  /** GET /health — readiness check */
  router.get('/', healthController.ready);

  /** GET /health/live — liveness check */
  router.get('/live', healthController.live);

  /** GET /metrics — Prometheus metrics */
  router.get('/metrics', metricsController.metrics);

  return router;
}
