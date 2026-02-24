/**
 * Multer configuration for multipart/form-data file uploads.
 *
 * Files are stored in memory (up to MAX_FILE_SIZE_MB).
 * For very large files in production consider switching to diskStorage
 * and streaming directly to the cloud provider.
 */

import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import { storageConfig } from '../../config';
import { UnsupportedMediaTypeError } from '../../utils/errors';

const storage = multer.memoryStorage();

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const allowedTypes = [
    ...storageConfig.allowedImageTypes,
    ...storageConfig.allowedVideoTypes,
    ...storageConfig.allowedDocumentTypes,
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new UnsupportedMediaTypeError(file.mimetype));
  }
}

export const uploadSingle = multer({
  storage,
  limits: { fileSize: storageConfig.maxFileSizeBytes },
  fileFilter,
}).single('file');

export const uploadMultiple = multer({
  storage,
  limits: { fileSize: storageConfig.maxFileSizeBytes },
  fileFilter,
}).array('files', 10);

// Re-export Multer's MulterError so it can be caught in the error middleware
export { MulterError } from 'multer';
