/**
 * Video processor backed by FFmpeg via the `fluent-ffmpeg` npm package.
 *
 * FFmpeg and FFprobe must be installed on the host (or Docker image).
 * Binary paths are configured via FFMPEG_PATH and FFPROBE_PATH.
 *
 * Responsibilities:
 *  - Extract thumbnail frames at a configurable offset
 *  - Transcode to web-safe MP4 (H.264 / AAC)
 *  - Probe: duration, resolution, codec, bitrate, FPS
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { IVideoProcessor, VideoProcessorOutput, VideoProbeResult } from '../../core/interfaces/processor.interface';
import { VideoProcessingOptions } from '../../core/types';
import { videoConfig } from '../../config';
import logger from '../../utils/logger';
import { ProcessingError } from '../../utils/errors';

// Configure binary paths from environment
if (videoConfig.ffmpegPath) ffmpeg.setFfmpegPath(videoConfig.ffmpegPath);
if (videoConfig.ffprobePath) ffmpeg.setFfprobePath(videoConfig.ffprobePath);

export class VideoProcessor implements IVideoProcessor {
  // ─── Process ───────────────────────────────────────────────────────────────

  async process(
    inputPath: string,
    outputDir: string,
    options: VideoProcessingOptions,
  ): Promise<VideoProcessorOutput> {
    // Always probe first to get native dimensions / duration
    let probeResult: VideoProbeResult;
    try {
      probeResult = await this.probe(inputPath);
    } catch (err) {
      throw new ProcessingError(`Cannot probe video at "${inputPath}"`, err);
    }

    const basename = path.basename(inputPath, path.extname(inputPath));
    let transcodedPath: string | undefined;
    let thumbnailPath: string | undefined;

    // Run operations in parallel if both are requested
    await Promise.all([
      options.transcode
        ? this.runTranscode(inputPath, path.join(outputDir, `${basename}-web.mp4`), options).then((p) => {
            transcodedPath = p;
          })
        : Promise.resolve(),
      options.generateThumbnail
        ? this.runThumbnail(inputPath, outputDir, basename, options).then((p) => {
            thumbnailPath = p;
          })
        : Promise.resolve(),
    ]);

    return {
      transcodedPath,
      thumbnailPath,
      duration: probeResult.duration,
      width: probeResult.width,
      height: probeResult.height,
    };
  }

  // ─── Internal: Transcode ──────────────────────────────────────────────────

  private runTranscode(
    input: string,
    outputPath: string,
    opts: VideoProcessingOptions,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let cmd = ffmpeg(input)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-movflags faststart', // enable progressive download
          '-preset fast',
          '-crf 23',
        ]);

      if (opts.resolution) cmd = cmd.size(opts.resolution);

      cmd
        .output(outputPath)
        .on('start', (cmdLine) => logger.debug('FFmpeg transcode started', { cmdLine }))
        .on('progress', (progress) =>
          logger.debug('FFmpeg progress', { percent: progress.percent }),
        )
        .on('end', () => {
          logger.info('FFmpeg: transcode complete', { outputPath });
          resolve(outputPath);
        })
        .on('error', (err: Error) => {
          logger.error('FFmpeg transcode error', { input, outputPath, error: err.message });
          reject(new ProcessingError('Video transcoding failed', err));
        })
        .run();
    });
  }

  // ─── Internal: Thumbnail ──────────────────────────────────────────────────

  private runThumbnail(
    input: string,
    outputDir: string,
    basename: string,
    opts: VideoProcessingOptions,
  ): Promise<string> {
    const second = opts.thumbnailSecond ?? videoConfig.thumbnailSecond;
    const filename = `${basename}-thumb.jpg`;

    return new Promise((resolve, reject) => {
      ffmpeg(input)
        .screenshots({
          timestamps: [second],
          filename,
          folder: outputDir,
        })
        .on('end', () => {
          const thumbPath = path.join(outputDir, filename);
          logger.info('FFmpeg: thumbnail extracted', { thumbPath, second });
          resolve(thumbPath);
        })
        .on('error', (err: Error) => {
          logger.error('FFmpeg thumbnail error', { input, error: err.message });
          reject(new ProcessingError('Video thumbnail extraction failed', err));
        });
    });
  }

  // ─── Probe ────────────────────────────────────────────────────────────────

  probe(inputPath: string): Promise<VideoProbeResult> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(new ProcessingError(`ffprobe failed for "${inputPath}"`, err));
          return;
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        const format = metadata.format;

        const fps = videoStream?.r_frame_rate
          ? this.parseFps(videoStream.r_frame_rate)
          : 0;

        resolve({
          duration: format.duration ?? 0,
          width: videoStream?.width ?? 0,
          height: videoStream?.height ?? 0,
          codec: videoStream?.codec_name ?? 'unknown',
          bitrate: parseInt(String(format.bit_rate ?? '0'), 10),
          fps,
          format: format.format_name ?? 'unknown',
        });
      });
    });
  }

  /** Parse "30000/1001" style FPS fractions returned by ffprobe. */
  private parseFps(fractionStr: string): number {
    const parts = fractionStr.split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0] ?? '0');
      const den = parseFloat(parts[1] ?? '1');
      return den !== 0 ? Math.round((num / den) * 100) / 100 : 0;
    }
    return parseFloat(fractionStr);
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  healthCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err) => resolve(!err));
    });
  }
}
