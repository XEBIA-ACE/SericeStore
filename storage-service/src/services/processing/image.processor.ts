/**
 * Image processor backed by GraphicsMagick / ImageMagick via the `gm` npm package.
 *
 * ImageMagick must be installed on the host (or Docker image).
 * The path to the `convert` binary is configured via IMAGE_MAGICK_PATH.
 *
 * Responsibilities:
 *  - Resize / thumbnail generation
 *  - Format conversion (JPEG, PNG, WebP, GIF)
 *  - EXIF / metadata stripping
 *  - Basic dimension inspection (identify)
 */

import gm from 'gm';
import fs from 'fs';
import path from 'path';
import { IImageProcessor, ImageProcessorOutput } from '../../core/interfaces/processor.interface';
import { ImageProcessingOptions } from '../../core/types';
import { imageConfig } from '../../config';
import logger from '../../utils/logger';
import { ProcessingError } from '../../utils/errors';

// Tell gm to use ImageMagick instead of GraphicsMagick
const imageMagick = gm.subClass({ imageMagick: true });

export class ImageProcessor implements IImageProcessor {
  // ─── Process ───────────────────────────────────────────────────────────────

  async process(
    inputPath: string,
    outputDir: string,
    options: ImageProcessingOptions,
  ): Promise<ImageProcessorOutput> {
    // Resolve dimensions first so callers always get them back
    let dimensions: { width: number; height: number; format: string };
    try {
      dimensions = await this.identify(inputPath);
    } catch (err) {
      throw new ProcessingError(`Cannot identify image at "${inputPath}"`, err);
    }

    const ext = options.convertTo ? `.${options.convertTo}` : path.extname(inputPath);
    const basename = path.basename(inputPath, path.extname(inputPath));
    const primaryPath = path.join(outputDir, `${basename}-processed${ext}`);

    // ── Primary processing ─────────────────────────────────────────────────
    await this.runPrimary(inputPath, primaryPath, options, dimensions);

    // ── Thumbnail ─────────────────────────────────────────────────────────
    let thumbnailPath: string | undefined;
    if (options.generateThumbnail) {
      thumbnailPath = path.join(outputDir, `${basename}-thumb${ext}`);
      await this.runThumbnail(inputPath, thumbnailPath, options);
    }

    const stats = fs.statSync(primaryPath);

    return {
      primaryPath,
      thumbnailPath,
      width: options.resize?.width ?? dimensions.width,
      height: options.resize?.height ?? dimensions.height,
      format: dimensions.format,
      sizeBytes: stats.size,
    };
  }

  // ─── Internal: Primary ────────────────────────────────────────────────────

  private runPrimary(
    input: string,
    output: string,
    opts: ImageProcessingOptions,
    dimensions: { width: number; height: number },
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let img = imageMagick(input);

      if (opts.stripMetadata) img = img.noProfile();

      if (opts.resize) {
        img = img.resize(opts.resize.width, opts.resize.height, '!'); // '!' = ignore aspect ratio
      }

      if (opts.quality) img = img.quality(opts.quality);

      img.write(output, (err) => {
        if (err) {
          logger.error('ImageMagick primary processing error', { input, output, err: String(err) });
          reject(new ProcessingError('Image processing failed', err));
        } else {
          logger.debug('ImageMagick: primary processed', { input, output });
          resolve();
        }
      });
    });
  }

  // ─── Internal: Thumbnail ──────────────────────────────────────────────────

  private runThumbnail(
    input: string,
    output: string,
    opts: ImageProcessingOptions,
  ): Promise<void> {
    const w = opts.thumbnailWidth ?? imageConfig.thumbnailWidth;
    const h = opts.thumbnailHeight ?? imageConfig.thumbnailHeight;

    return new Promise((resolve, reject) => {
      imageMagick(input)
        .thumb(w, h, output, opts.quality ?? imageConfig.defaultQuality, (err) => {
          if (err) {
            logger.error('ImageMagick thumbnail error', { input, output, err: String(err) });
            reject(new ProcessingError('Thumbnail generation failed', err));
          } else {
            logger.debug('ImageMagick: thumbnail created', { output, w, h });
            resolve();
          }
        });
    });
  }

  // ─── Identify ─────────────────────────────────────────────────────────────

  identify(inputPath: string): Promise<{ width: number; height: number; format: string }> {
    return new Promise((resolve, reject) => {
      imageMagick(inputPath).identify((err, data) => {
        if (err) {
          reject(new ProcessingError(`identify failed for "${inputPath}"`, err));
          return;
        }
        resolve({
          width: data.size?.width ?? 0,
          height: data.size?.height ?? 0,
          format: data.format ?? 'UNKNOWN',
        });
      });
    });
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      // `gm version` exits cleanly when ImageMagick is present
      imageMagick().version((err) => resolve(!err));
    });
  }
}
