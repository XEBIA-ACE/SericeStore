/**
 * Base application error — every domain/service error extends this.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier ? `${resource} '${identifier}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND',
    );
  }
}

export class ValidationError extends AppError {
  public readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 502, 'STORAGE_ERROR');
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack ?? cause.message}`;
    }
  }
}

export class MediaProcessingError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 422, 'MEDIA_PROCESSING_ERROR');
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack ?? cause.message}`;
    }
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(mimeType: string) {
    super(`Unsupported media type: ${mimeType}`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

export class FileTooLargeError extends AppError {
  constructor(maxSizeMb: number) {
    super(`File exceeds maximum allowed size of ${maxSizeMb} MB`, 413, 'FILE_TOO_LARGE');
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}
