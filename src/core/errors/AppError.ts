/**
 * Base application error that carries an HTTP status code and a machine-readable
 * error code. All domain-specific errors should extend this class.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    errorCode = 'INTERNAL_ERROR',
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ── Concrete error types ──────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  public readonly details: unknown;

  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 500, 'STORAGE_ERROR');
    if (cause) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack ?? ''}`;
    }
  }
}

export class MediaProcessingError extends AppError {
  constructor(message: string, cause?: Error) {
    super(message, 422, 'MEDIA_PROCESSING_ERROR');
    if (cause) {
      this.stack = `${this.stack ?? ''}\nCaused by: ${cause.stack ?? ''}`;
    }
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(mimeType: string) {
    super(`Unsupported media type: ${mimeType}`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

export class FileTooLargeError extends AppError {
  constructor(maxSize: number) {
    super(`File exceeds maximum allowed size of ${maxSize} bytes`, 413, 'FILE_TOO_LARGE');
  }
}
