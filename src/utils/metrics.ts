import client from 'prom-client';

// Enable default Node.js process metrics (heap, CPU, event-loop, etc.)
client.collectDefaultMetrics({ prefix: 'storage_service_' });

// ---------------------------------------------------------------------------
// Custom counters / histograms
// ---------------------------------------------------------------------------

/** Total HTTP requests by method, route, and status */
export const httpRequestsTotal = new client.Counter({
  name: 'storage_service_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

/** HTTP request duration histogram */
export const httpRequestDurationMs = new client.Histogram({
  name: 'storage_service_http_request_duration_ms',
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

/** Bytes uploaded to storage */
export const storageBytesUploaded = new client.Counter({
  name: 'storage_service_bytes_uploaded_total',
  help: 'Total bytes uploaded to storage',
  labelNames: ['provider'],
});

/** Bytes downloaded from storage */
export const storageBytesDownloaded = new client.Counter({
  name: 'storage_service_bytes_downloaded_total',
  help: 'Total bytes downloaded from storage',
  labelNames: ['provider'],
});

/** Media processing operations */
export const mediaProcessingTotal = new client.Counter({
  name: 'storage_service_media_processing_total',
  help: 'Total media processing operations',
  labelNames: ['type', 'status'],
});

/** Media processing duration histogram */
export const mediaProcessingDurationMs = new client.Histogram({
  name: 'storage_service_media_processing_duration_ms',
  help: 'Duration of media processing jobs in milliseconds',
  labelNames: ['type'],
  buckets: [100, 500, 1000, 5000, 10000, 30000, 60000],
});

export const register = client.register;
