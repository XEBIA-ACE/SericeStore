import { Router } from 'express';
import { HealthController } from '../controllers/health.controller';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();

  /** GET /health/live  — Kubernetes liveness probe */
  router.get('/live', controller.liveness);

  /** GET /health/ready — Kubernetes readiness probe */
  router.get('/ready', controller.readiness);

  return router;
}
