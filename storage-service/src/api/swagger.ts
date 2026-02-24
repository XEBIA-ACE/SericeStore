/**
 * OpenAPI / Swagger specification generator.
 * swagger-jsdoc reads JSDoc @swagger annotations from controller files.
 */

import swaggerJsdoc from 'swagger-jsdoc';
import { appConfig } from '../config';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SericeStore — Storage Service API',
      version: appConfig.version,
      description: `
Multi-cloud storage service supporting Amazon S3, Google Cloud Storage, and MinIO backends.
Provides file upload/download, presigned URLs, image processing (ImageMagick) and video processing (FFmpeg).

## Authentication
All file endpoints require a Bearer JWT token in the \`Authorization\` header
unless \`AUTH_ENABLED=false\` is set (development only).

## Storage Backends
Switch the active backend via the \`STORAGE_PROVIDER\` environment variable: \`s3\`, \`gcs\`, or \`minio\`.
      `,
      contact: { name: 'SericeStore', email: 'support@example.com' },
      license: { name: 'MIT' },
    },
    servers: [
      { url: `http://localhost:${appConfig.port}`, description: 'Local development' },
      { url: 'https://storage.example.com', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        FileMetadata: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            originalName: { type: 'string' },
            key: { type: 'string' },
            mimeType: { type: 'string' },
            size: { type: 'integer' },
            category: { type: 'string', enum: ['image', 'video', 'document', 'other'] },
            bucket: { type: 'string' },
            provider: { type: 'string', enum: ['s3', 'gcs', 'minio'] },
            uploadedAt: { type: 'string', format: 'date-time' },
            uploadedBy: { type: 'string' },
            tags: { type: 'object', additionalProperties: { type: 'string' } },
            processing: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
                thumbnailKey: { type: 'string' },
                thumbnailUrl: { type: 'string' },
                width: { type: 'integer' },
                height: { type: 'integer' },
                duration: { type: 'number' },
                error: { type: 'string' },
              },
            },
          },
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
            meta: {
              type: 'object',
              properties: {
                requestId: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Files', description: 'File CRUD and processing operations' },
      { name: 'Health', description: 'Liveness and readiness probes' },
      { name: 'Observability', description: 'Metrics and monitoring' },
    ],
  },
  apis: ['./src/api/controllers/*.ts', './src/api/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
