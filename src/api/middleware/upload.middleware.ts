import multer, { StorageEngine, FileFilterCallback } from 'multer';
import { Request } from 'express';
import os from 'os';
import path from 'path';
import { config } from '../../config';
import { UnsupportedMediaTypeError, FileTooLargeError } from '../../core/errors/AppError';

/**
 * Multer storage — use disk storage so that large uploads don't saturate
 * Node's heap.  Files land in TEMP_DIR and are cleaned up by the controller
 * after successful processing / upload.
 */
const storage: StorageEngine = multer.diskStorage({
  destination: (_, __, cb) => cb(null, config.TEMP_DIR || os.tmpdir()),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Use a timestamp prefix to avoid name collisions in the temp dir
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

/**
 * File-type filter — rejects files whose MIME type is not in the
 * ALLOWED_MIME_TYPES list.
 */
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  const allowed = config.ALLOWED_MIME_TYPES;

  if (allowed.includes('*') || allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new UnsupportedMediaTypeError(file.mimetype));
  }
};

/** Single-file upload (field name: "file") */
export const singleUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.MAX_FILE_SIZE },
}).single('file');

/** Multi-file upload (field name: "files", max 10) */
export const multiUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.MAX_FILE_SIZE },
}).array('files', 10);

/**
 * Wrap multer errors into our AppError hierarchy so they reach the global
 * error handler with the right HTTP status codes.
 */
export function handleMulterError(
  err: unknown,
  _req: Request,
  _res: unknown,
  next: (err?: unknown) => void,
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new FileTooLargeError(config.MAX_FILE_SIZE));
    }
    return next(err);
  }
  next(err);
}
