import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../core/errors/AppError';

/** Validate query / params with a Joi schema and forward a ValidationError on failure. */
function validate(
  schema: Joi.ObjectSchema,
  source: 'params' | 'query' | 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
    if (error) {
      return next(
        new ValidationError(
          'Request validation failed',
          error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
        ),
      );
    }
    req[source] = value as typeof req[typeof source];
    next();
  };
}

// ── Schemas ──────────────────────────────────────────────────────────────────

export const uploadQuerySchema = Joi.object({
  processImage: Joi.boolean().default(false),
  bucket: Joi.string().max(63).optional(),
});

export const objectKeyParamSchema = Joi.object({
  /**
   * Key is URL-encoded; any slash-separated path is valid.
   * We validate the decoded value contains only safe characters.
   */
  key: Joi.string()
    .max(1024)
    .pattern(/^[a-zA-Z0-9!_.*'()\-\/]+$/)
    .required(),
});

export const listQuerySchema = Joi.object({
  prefix: Joi.string().max(256).optional(),
  maxKeys: Joi.number().integer().min(1).max(1000).default(100),
  bucket: Joi.string().max(63).optional(),
});

export const presignedUrlQuerySchema = Joi.object({
  expiresIn: Joi.number().integer().min(60).max(604800).default(3600),
  bucket: Joi.string().max(63).optional(),
});

export const copyBodySchema = Joi.object({
  sourceKey: Joi.string().max(1024).required(),
  destKey: Joi.string().max(1024).required(),
  sourceBucket: Joi.string().max(63).optional(),
  destBucket: Joi.string().max(63).optional(),
});

// ── Exported middleware ───────────────────────────────────────────────────────

export const validateUploadQuery = validate(uploadQuerySchema, 'query');
export const validateObjectKeyParam = validate(objectKeyParamSchema, 'params');
export const validateListQuery = validate(listQuerySchema, 'query');
export const validatePresignedUrlQuery = validate(presignedUrlQuerySchema, 'query');
export const validateCopyBody = validate(copyBodySchema, 'body');
