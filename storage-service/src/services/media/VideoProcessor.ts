import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { IVideoProcessor, VideoProcessingOptions } from '../../core/interfaces/IMediaProcessor';
import { ProcessedVideo } from '../../core/entities/StoredObject';
import { MediaProcessingError } from '../../core/errors/AppError';
import { createLogger } from '../../utils/logger';
import { config } from '../../config';

const log = createLogger('VideoProcessor');

// Point fluent-ffmpeg at the binary configured in the environment
if (config.media.ffmpegPath) {
  ffmpeg.setFfmpegPath(config.media.ffmpegPath);
}

/**
 * Video processor backed by FFmpeg via fluent-ffmpeg.
 *
 * Accepts local file paths (callers must buffer-to-temp-file first and
 * clean up afterwards).
 */
export class VideoProcessor implements IVideoProcessor {
  async transcode(
    inputPath: string,
    outputPath: string,
    options: VideoProcessingOptions = {},
  ): Promise<ProcessedVideo> {
    const codec = options.codec ?? config.media.videoOutputCodec;
    const audioCodec = options.audioCodec ?? config.media.videoOutputAudioCodec;
    const format = options.format ?? config.media.videoOutputFormat;

    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(inputPath)
        .videoCodec(codec)
        .audioCodec(audioCodec)
        .format(format)
        .output(outputPath);

      if (options.width && options.height) {
        cmd = cmd.size(`${options.width}x${options.height}`);
      }
      if (options.fps) {
        cmd = cmd.fps(options.fps);
      }
      if (options.videoBitrate) {
        cmd = cmd.videoBitrate(options.videoBitrate);
      }
      if (options.audioBitrate) {
        cmd = cmd.audioBitrate(options.audioBitrate);
      }

      cmd
        .on('start', (cmdLine) => log.debug('FFmpeg started', { cmdLine }))
        .on('progress', (progress) =>
          log.debug('FFmpeg progress', { percent: progress.percent }),
        )
        .on('end', async () => {
          try {
            const metadata = await this.getMetadata(outputPath);
            const size = (await fs.promises.stat(outputPath)).size;
            log.info('Video transcode complete', { outputPath, ...metadata });
            resolve({ key: outputPath, ...metadata, size, format, codec });
          } catch (err) {
            reject(new MediaProcessingError('Failed to read transcoded video metadata', err));
          }
        })
        .on('error', (err) => {
          log.error('FFmpeg transcode error', { err });
          reject(new MediaProcessingError('Video transcoding failed', err));
        })
        .run();
    });
  }

  async extractThumbnail(
    inputPath: string,
    outputDir: string,
    timestampSeconds = 1,
  ): Promise<Buffer> {
    const filename = `thumb_${Date.now()}.jpg`;
    const outputPath = path.join(outputDir, filename);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: [timestampSeconds],
          filename,
          folder: outputDir,
          size: `${config.media.imageThumbnailWidth}x${config.media.imageThumbnailHeight}`,
        })
        .on('end', () => resolve())
        .on('error', (err) =>
          reject(new MediaProcessingError('Thumbnail extraction failed', err)),
        );
    });

    const buffer = await fs.promises.readFile(outputPath);
    // Clean up temp thumbnail file
    await fs.promises.unlink(outputPath).catch(() => undefined);
    return buffer;
  }

  async getMetadata(
    inputPath: string,
  ): Promise<Pick<ProcessedVideo, 'duration' | 'width' | 'height' | 'format' | 'codec'>> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          return reject(new MediaProcessingError('Failed to probe video metadata', err));
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        const format = metadata.format;

        resolve({
          duration: format.duration ?? 0,
          width: videoStream?.width ?? 0,
          height: videoStream?.height ?? 0,
          format: format.format_name ?? 'unknown',
          codec: videoStream?.codec_name ?? 'unknown',
        });
      });
    });
  }
}
