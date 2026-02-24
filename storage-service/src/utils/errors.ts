/**
 * Domain error hierarchy.
 * Use these throughout the business-logic and data-access layers
 * so the error-handling middleware can map them to the correct HTTP status.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, 'STORAGE_ERROR');
    if (cause instanceof Error) this.stack += `\nCaused by: ${cause.stack ?? cause.message}`;
  }
}

export class ProcessingError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 422, 'PROCESSING_ERROR');
    if (cause instanceof Error) this.stack += `\nCaused by: ${cause.stack ?? cause.message}`;
  }
}

export class FileTooLargeError extends AppError {
  constructor(maxBytes: number) {
    super(`File exceeds maximum allowed size of ${Math.round(maxBytes / 1024 / 1024)} MB`, 413, 'FILE_TOO_LARGE');
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(mimeType: string) {
    super(`Unsupported media type: ${mimeType}`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}
