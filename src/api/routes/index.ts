import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { createHealthRouter } from './health.routes';
import { createStorageRouter } from './storage.routes';
import { createMediaRouter } from './media.routes';
import { HealthController } from '../controllers/HealthController';
import { StorageController } from '../controllers/StorageController';
import { MediaController } from '../controllers/MediaController';
import { config } from '../../config';

// ---------------------------------------------------------------------------
// OpenAPI / Swagger spec
// ---------------------------------------------------------------------------
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Storage Service API',
      version: '1.0.0',
      description:
        'Multi-cloud object storage service with ImageMagick and FFmpeg media processing. ' +
        'Supports Amazon S3, Google Cloud Storage, and MinIO backends.',
    },
    servers: [{ url: config.API_PREFIX, description: 'Current environment' }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
        },
      },
    },
    tags: [
      { name: 'Health', description: 'Service health and observability' },
      { name: 'Storage', description: 'Object storage operations' },
      { name: 'Media', description: 'Image and video processing' },
    ],
  },
  apis: ['./src/api/routes/*.ts'],
});

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------
export function createRouter(
  healthController: HealthController,
  storageController: StorageController,
  mediaController: MediaController,
): Router {
  const router = Router();

  // Swagger UI
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  router.get('/docs.json', (_req, res) => res.json(swaggerSpec));

  // Health / metrics
  router.use('/health', createHealthRouter(healthController));

  // Storage operations
  router.use('/storage', createStorageRouter(storageController));

  // Media processing
  router.use('/media', createMediaRouter(mediaController));

  return router;
}
