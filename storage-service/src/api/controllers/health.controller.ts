/**
 * HealthController — liveness, readiness, and Prometheus metrics endpoints.
 */

import { Request, Response } from 'express';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import { FileService } from '../../services/file.service';
import { appConfig } from '../../config';

// Collect default Node.js process metrics (event loop, heap, etc.)
collectDefaultMetrics({ labels: { service: appConfig.serviceName } });

// ── Custom business metrics ────────────────────────────────────────────────

export const uploadCounter = new Counter({
  name: 'storage_files_uploaded_total',
  help: 'Total number of files uploaded',
  labelNames: ['status', 'category'],
});

export const downloadCounter = new Counter({
  name: 'storage_files_downloaded_total',
  help: 'Total number of file downloads',
  labelNames: ['status'],
});

export const uploadDuration = new Histogram({
  name: 'storage_upload_duration_seconds',
  help: 'Upload operation duration in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const fileSizeHistogram = new Histogram({
  name: 'storage_file_size_bytes',
  help: 'Size of uploaded files in bytes',
  buckets: [1024, 10240, 102400, 1048576, 10485760, 104857600],
});

// ── Controller ─────────────────────────────────────────────────────────────

export class HealthController {
  constructor(private readonly fileService: FileService) {}

  /**
   * @swagger
   * /health/live:
   *   get:
   *     summary: Liveness probe — always returns 200 while the process is running
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Service is alive
   */
  liveness = (_req: Request, res: Response): void => {
    res.json({
      status: 'ok',
      service: appConfig.serviceName,
      version: appConfig.version,
      timestamp: new Date().toISOString(),
    });
  };

  /**
   * @swagger
   * /health/ready:
   *   get:
   *     summary: Readiness probe — checks storage and processor connectivity
   *     tags: [Health]
   *     responses:
   *       200:
   *         description: Service is ready
   *       503:
   *         description: One or more dependencies are unavailable
   */
  readiness = async (_req: Request, res: Response): Promise<void> => {
    const checks = await this.fileService.healthCheck();

    const allHealthy = Object.values(checks).every(Boolean);
    const status = allHealthy ? 'ok' : 'degraded';

    res.status(allHealthy ? 200 : 503).json({
      status,
      service: appConfig.serviceName,
      version: appConfig.version,
      checks: {
        storage: checks.storage ? 'ok' : 'fail',
        imageProcessor: checks.imageProcessor ? 'ok' : 'fail',
        videoProcessor: checks.videoProcessor ? 'ok' : 'fail',
      },
      timestamp: new Date().toISOString(),
    });
  };

  /**
   * @swagger
   * /metrics:
   *   get:
   *     summary: Prometheus metrics
   *     tags: [Observability]
   *     responses:
   *       200:
   *         description: Prometheus text format
   */
  metrics = async (_req: Request, res: Response): Promise<void> => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  };
}
