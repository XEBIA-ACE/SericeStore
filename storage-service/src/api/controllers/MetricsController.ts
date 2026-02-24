import { Request, Response } from 'express';
import client from 'prom-client';

// Create a shared Registry
const registry = new client.Registry();

// Collect default Node.js metrics (event loop lag, GC, memory, etc.)
client.collectDefaultMetrics({ register: registry, prefix: 'storage_service_' });

// ── Custom metrics ───────────────────────────────────────────────────────────

export const uploadCounter = new client.Counter({
  name: 'storage_service_uploads_total',
  help: 'Total number of upload operations',
  labelNames: ['provider', 'content_type', 'status'],
  registers: [registry],
});

export const uploadDuration = new client.Histogram({
  name: 'storage_service_upload_duration_seconds',
  help: 'Upload operation duration in seconds',
  labelNames: ['provider'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const downloadCounter = new client.Counter({
  name: 'storage_service_downloads_total',
  help: 'Total number of download operations',
  labelNames: ['provider', 'status'],
  registers: [registry],
});

export const objectsDeleted = new client.Counter({
  name: 'storage_service_deletes_total',
  help: 'Total number of delete operations',
  labelNames: ['provider'],
  registers: [registry],
});

/**
 * GET /metrics — Prometheus scrape endpoint.
 */
export class MetricsController {
  metrics = async (_req: Request, res: Response): Promise<void> => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  };
}
