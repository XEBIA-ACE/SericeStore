import { Router } from 'express';
import { HealthController } from '../controllers/HealthController';
import { AppRequest } from '../../core/types';

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();

  /**
   * @openapi
   * /health:
   *   get:
   *     summary: Liveness probe
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Service is alive
   */
  router.get('/', (req, res) => controller.liveness(req as AppRequest, res));

  /**
   * @openapi
   * /health/ready:
   *   get:
   *     summary: Readiness probe
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Service is ready to accept traffic
   */
  router.get('/ready', (req, res) => controller.readiness(req as AppRequest, res));

  return router;
}
