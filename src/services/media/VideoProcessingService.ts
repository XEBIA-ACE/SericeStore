import ffmpeg, { FfprobeData, FfprobeStream } from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import {
  IVideoProcessor,
  VideoTranscodeOptions,
  VideoMetadata,
  ThumbnailOptions,
} from '../../core/interfaces/IMediaProcessor';
import { MediaProcessingError } from '../../core/errors/AppError';
import { config } from '../../config';
import { logger } from '../../utils/logger';

// Configure FFmpeg / FFprobe binary paths if provided
if (config.FFMPEG_PATH) ffmpeg.setFfmpegPath(config.FFMPEG_PATH);
if (config.FFPROBE_PATH) ffmpeg.setFfprobePath(config.FFPROBE_PATH);

/**
 * VideoProcessingService
 *
 * Wraps FFmpeg (via fluent-ffmpeg) to provide video/audio transcoding,
 * thumbnail extraction, and media probe operations.
 */
export class VideoProcessingService implements IVideoProcessor {
  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Transcode a video or audio file to the specified format and codec settings.
   */
  async transcode(
    inputPath: string,
    outputPath: string,
    options: VideoTranscodeOptions,
  ): Promise<void> {
    logger.debug('Starting video transcode', { inputPath, outputPath, options });
    const start = Date.now();

    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      let cmd = ffmpeg(inputPath);

      if (options.videoCodec) cmd = cmd.videoCodec(options.videoCodec);
      if (options.audioCodec) cmd = cmd.audioCodec(options.audioCodec);
      if (options.videoBitrate) cmd = cmd.videoBitrate(options.videoBitrate);
      if (options.audioBitrate) cmd = cmd.audioBitrate(options.audioBitrate);
      if (options.fps) cmd = cmd.fps(options.fps);
      if (options.format) cmd = cmd.format(options.format);

      if (options.width || options.height) {
        const w = options.width ?? -2;
        const h = options.height ?? -2;
        // -2 tells FFmpeg to keep the dimension divisible by 2 while scaling
        cmd = cmd.size(`${w}x${h}`);
      }

      cmd
        .on('progress', (progress) => {
          logger.debug('Transcode progress', { percent: progress.percent });
        })
        .on('error', (err) => {
          logger.error('Transcode failed', { error: err.message, inputPath });
          reject(new MediaProcessingError(`Transcode failed: ${err.message}`, err));
        })
        .on('end', () => {
          logger.info('Video transcoded', {
            inputPath,
            outputPath,
            durationMs: Date.now() - start,
          });
          resolve();
        })
        .save(outputPath);
    });
  }

  /**
   * Extract a single video frame as an image file.
   */
  async extractThumbnail(
    inputPath: string,
    outputPath: string,
    options: ThumbnailOptions = {},
  ): Promise<void> {
    const { timestamp = 0, width = 320, format = 'jpeg' } = options;
    logger.debug('Extracting thumbnail', { inputPath, outputPath, timestamp });

    return new Promise((resolve, reject) => {
      const outputDir = path.dirname(outputPath);
      const outputFile = path.basename(outputPath);
      fs.mkdirSync(outputDir, { recursive: true });

      let cmd = ffmpeg(inputPath).seekInput(timestamp);

      if (width) cmd = cmd.size(`${width}x?`);

      cmd
        .frames(1)
        .outputFormat('image2')
        .outputOption(`-vcodec ${format === 'png' ? 'png' : 'mjpeg'}`)
        .on('error', (err) => {
          reject(new MediaProcessingError(`Thumbnail extraction failed: ${err.message}`, err));
        })
        .on('end', () => {
          logger.info('Thumbnail extracted', { outputPath });
          resolve();
        })
        .output(path.join(outputDir, outputFile))
        .run();
    });
  }

  /**
   * Probe a video/audio file and return structured metadata.
   */
  async getMetadata(inputPath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, data: FfprobeData) => {
        if (err) {
          reject(new MediaProcessingError(`Failed to probe "${inputPath}": ${err.message}`, err));
          return;
        }

        const videoStream = data.streams.find(
          (s: FfprobeStream) => s.codec_type === 'video',
        );
        const audioStream = data.streams.find(
          (s: FfprobeStream) => s.codec_type === 'audio',
        );

        const fpsFraction = videoStream?.r_frame_rate?.split('/');
        const fps =
          fpsFraction && fpsFraction.length === 2
            ? Math.round(parseInt(fpsFraction[0], 10) / parseInt(fpsFraction[1], 10))
            : undefined;

        resolve({
          duration: parseFloat(String(data.format.duration ?? 0)),
          width: videoStream?.width,
          height: videoStream?.height,
          fps,
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name,
          bitrate: parseInt(String(data.format.bit_rate ?? 0), 10),
          size: parseInt(String(data.format.size ?? 0), 10),
          format: String(data.format.format_name ?? ''),
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
    return path.join(dir, `vid-${uuidv4()}${ext}`);
  }
}
