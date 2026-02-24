import gm from 'gm';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import {
  IImageProcessor,
  ImageTransformOptions,
  ImageMetadata,
} from '../../core/interfaces/IMediaProcessor';
import { MediaProcessingError } from '../../core/errors/AppError';
import { config } from '../../config';
import { logger } from '../../utils/logger';

// Use the ImageMagick sub-class of `gm`
const im = gm.subClass({ imageMagick: true, appPath: config.IMAGEMAGICK_PATH || undefined });

/**
 * ImageProcessingService
 *
 * Wraps ImageMagick (via the `gm` package) to provide image transformation
 * and metadata extraction.  All operations work on local file paths so that
 * the caller is responsible for downloading the source file and uploading the
 * result (see MediaController for the orchestration layer).
 */
export class ImageProcessingService implements IImageProcessor {
  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Apply one or more transformations to an image and write the result to
   * outputPath.  The input file is never modified.
   */
  async transform(
    inputPath: string,
    outputPath: string,
    options: ImageTransformOptions,
  ): Promise<void> {
    logger.debug('Starting image transform', { inputPath, outputPath, options });
    const start = Date.now();

    return new Promise((resolve, reject) => {
      let state = im(inputPath);

      // ── Resize ────────────────────────────────────────────────────────────
      if (options.width || options.height) {
        const w = options.width ?? 0;
        const h = options.height ?? 0;
        const fit = options.fit ?? 'cover';

        switch (fit) {
          case 'cover':
            // ^ fills the frame, cropping as needed
            state = state.resize(w || undefined, h || undefined, '^');
            if (w && h) state = state.gravity('Center').extent(w, h);
            break;
          case 'contain':
            state = state.resize(w || undefined, h || undefined);
            break;
          case 'fill':
            state = state.resize(w || undefined, h || undefined, '!');
            break;
          case 'inside':
            state = state.resize(w || undefined, h || undefined, '>');
            break;
          case 'outside':
            state = state.resize(w || undefined, h || undefined, '<');
            break;
        }
      }

      // ── Rotate ────────────────────────────────────────────────────────────
      if (options.rotate) {
        state = state.rotate('white', options.rotate);
      }

      // ── Flip ──────────────────────────────────────────────────────────────
      if (options.flipX) state = state.flop();
      if (options.flipY) state = state.flip();

      // ── Greyscale ─────────────────────────────────────────────────────────
      if (options.greyscale) state = state.type('Grayscale');

      // ── Quality ───────────────────────────────────────────────────────────
      if (options.quality != null) state = state.quality(options.quality);

      // ── Format ────────────────────────────────────────────────────────────
      if (options.format) {
        // gm uses the output extension to determine format by default,
        // but we can be explicit
        state = state.setFormat(options.format);
      }

      // Ensure output directory exists
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      state.write(outputPath, (err) => {
        if (err) {
          logger.error('Image transform failed', { error: err.message, inputPath });
          reject(new MediaProcessingError(`Image transform failed: ${err.message}`, err));
        } else {
          logger.info('Image transformed', {
            inputPath,
            outputPath,
            durationMs: Date.now() - start,
          });
          resolve();
        }
      });
    });
  }

  /**
   * Extract image metadata (dimensions, format, colour space, etc.)
   */
  async getMetadata(inputPath: string): Promise<ImageMetadata> {
    return new Promise((resolve, reject) => {
      im(inputPath).identify((err, data) => {
        if (err) {
          reject(new MediaProcessingError(`Failed to read image metadata: ${err.message}`, err));
          return;
        }

        const size = data['Image']['Geometry'] as string;
        const [widthStr, heightStr] = size.split('+')[0].split('x');

        resolve({
          width: parseInt(widthStr, 10),
          height: parseInt(heightStr, 10),
          format: String(data['Image']['Format'] ?? '').toLowerCase(),
          colorspace: String(data['Image']['Colorspace'] ?? 'Unknown'),
          size: fs.statSync(inputPath).size,
        });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Create a temp file path in the configured temp directory */
  static tempPath(ext = ''): string {
    const dir = config.TEMP_DIR || os.tmpdir();
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `img-${uuidv4()}${ext}`);
  }
}
