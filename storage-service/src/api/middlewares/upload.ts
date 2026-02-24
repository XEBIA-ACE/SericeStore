import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import { config } from '../../config';

const allAllowedTypes = [
  ...config.upload.allowedImageTypes,
  ...config.upload.allowedVideoTypes,
  ...config.upload.allowedDocumentTypes,
];

/**
 * Multer instance using in-memory storage.
 * Files are kept as Buffer so the storage service can process them
 * before writing to the cloud backend.
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
  },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback,
  ) => {
    if (allAllowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});
