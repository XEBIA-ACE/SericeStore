import sharp from 'sharp';
import { IImageProcessor, ImageProcessingOptions } from '../../core/interfaces/IMediaProcessor';
import { ProcessedImage } from '../../core/entities/StoredObject';
import { MediaProcessingError } from '../../core/errors/AppError';
import { createLogger } from '../../utils/logger';
import { config } from '../../config';

const log = createLogger('ImageProcessor');

/**
 * Image processor backed by sharp (libvips).
 *
 * Sharp is the recommended high-performance Node.js image processing library.
 * For workflows requiring the full ImageMagick CLI feature set (e.g. complex
 * compositing or advanced colour profiles), use the gm adapter instead and
 * point IMAGEMAGICK_PATH at the system `convert` binary.
 */
export class ImageProcessor implements IImageProcessor {
  async process(
    buffer: Buffer,
    outputKey: string,
    options: ImageProcessingOptions = {},
  ): Promise<{
    processedBuffer: Buffer;
    thumbnailBuffer?: Buffer;
    metadata: ProcessedImage;
  }> {
    try {
      log.debug('Processing image', { outputKey, options });

      let pipeline = sharp(buffer);

      // Resize if dimensions were requested
      if (options.width || options.height) {
        pipeline = pipeline.resize({
          width: options.width || undefined,
          height: options.height || undefined,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Format conversion
      const targetFormat = options.format ?? 'jpeg';
      switch (targetFormat) {
        case 'jpeg':
          pipeline = pipeline.jpeg({ quality: options.quality ?? config.media.imageQuality });
          break;
        case 'png':
          pipeline = pipeline.png({ compressionLevel: 8 });
          break;
        case 'webp':
          pipeline = pipeline.webp({ quality: options.quality ?? config.media.imageQuality });
          break;
        case 'tiff':
          pipeline = pipeline.tiff();
          break;
      }

      const processedBuffer = await pipeline.toBuffer();
      const meta = await sharp(processedBuffer).metadata();

      const processed: ProcessedImage = {
        key: outputKey,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        format: meta.format ?? targetFormat,
        size: processedBuffer.length,
      };

      // Generate thumbnail if requested
      let thumbnailBuffer: Buffer | undefined;
      if (options.generateThumbnail) {
        thumbnailBuffer = await this.generateThumbnail(
          buffer, // use original for the thumbnail so it isn't double-compressed
          options.thumbnailWidth ?? config.media.imageThumbnailWidth,
          options.thumbnailHeight ?? config.media.imageThumbnailHeight,
        );
        processed.thumbnailKey = outputKey; // caller will override with real thumbnail key
      }

      log.info('Image processing complete', { outputKey, ...processed });
      return { processedBuffer, thumbnailBuffer, metadata: processed };
    } catch (err) {
      log.error('Image processing failed', { outputKey, err });
      throw new MediaProcessingError('Image processing failed', err);
    }
  }

  async getMetadata(
    buffer: Buffer,
  ): Promise<Pick<ProcessedImage, 'width' | 'height' | 'format' | 'size'>> {
    try {
      const meta = await sharp(buffer).metadata();
      return {
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        format: meta.format ?? 'unknown',
        size: buffer.length,
      };
    } catch (err) {
      throw new MediaProcessingError('Failed to read image metadata', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async generateThumbnail(
    sourceBuffer: Buffer,
    width: number,
    height: number,
  ): Promise<Buffer> {
    return sharp(sourceBuffer)
      .resize({ width, height, fit: 'cover' })
      .jpeg({ quality: 75 })
      .toBuffer();
  }
}
