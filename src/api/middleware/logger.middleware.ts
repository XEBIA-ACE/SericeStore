import morgan from 'morgan';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// Pipe morgan output through our Winston logger so all logs are structured
const stream = {
  write: (message: string): void => {
    logger.http(message.trim());
  },
};

// Skip logging in test environments
const skip = (): boolean => config.NODE_ENV === 'test';

export const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  { stream, skip },
);
