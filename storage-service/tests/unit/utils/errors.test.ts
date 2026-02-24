import {
  AppError,
  ValidationError,
  NotFoundError,
  StorageError,
  FileTooLargeError,
  UnsupportedMediaTypeError,
} from '../../../src/utils/errors';

describe('AppError hierarchy', () => {
  it('AppError stores statusCode, code, and message', () => {
    const err = new AppError('Something went wrong', 500, 'INTERNAL');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL');
    expect(err.message).toBe('Something went wrong');
    expect(err.isOperational).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('ValidationError uses 400', () => {
    const err = new ValidationError('Bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('NotFoundError uses 404', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('StorageError uses 502', () => {
    const cause = new Error('network failure');
    const err = new StorageError('Provider unreachable', cause);
    expect(err.statusCode).toBe(502);
    expect(err.stack).toContain('network failure');
  });

  it('FileTooLargeError includes MB in message', () => {
    const err = new FileTooLargeError(10 * 1024 * 1024);
    expect(err.statusCode).toBe(413);
    expect(err.message).toContain('10 MB');
  });

  it('UnsupportedMediaTypeError includes MIME type in message', () => {
    const err = new UnsupportedMediaTypeError('application/zip');
    expect(err.statusCode).toBe(415);
    expect(err.message).toContain('application/zip');
  });
});
