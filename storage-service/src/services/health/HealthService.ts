import { IStorageProvider } from '../../core/interfaces/IStorageProvider';
import { createLogger } from '../../utils/logger';
import { config } from '../../config';

const log = createLogger('HealthService');

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  checks: Record<string, CheckResult>;
}

export interface CheckResult {
  status: 'pass' | 'fail';
  latencyMs?: number;
  message?: string;
}

/**
 * Aggregates health checks for all subsystems.
 */
export class HealthService {
  private readonly startTime = Date.now();

  constructor(private readonly storageProvider: IStorageProvider) {}

  async check(): Promise<HealthStatus> {
    const checks: Record<string, CheckResult> = {};

    // Storage provider check
    const storageCheck = await this.checkStorage();
    checks[`storage.${this.storageProvider.name}`] = storageCheck;

    const allPassing = Object.values(checks).every((c) => c.status === 'pass');
    const anyFailing = Object.values(checks).some((c) => c.status === 'fail');

    return {
      status: allPassing ? 'healthy' : anyFailing ? 'unhealthy' : 'degraded',
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /** Lightweight liveness check (no external I/O) */
  live(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.floor((Date.now() - this.startTime) / 1000) };
  }

  private async checkStorage(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const ok = await this.storageProvider.healthCheck();
      return {
        status: ok ? 'pass' : 'fail',
        latencyMs: Date.now() - start,
        message: ok ? undefined : 'Storage health check returned false',
      };
    } catch (err) {
      log.warn('Storage health check threw', { err });
      return {
        status: 'fail',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
