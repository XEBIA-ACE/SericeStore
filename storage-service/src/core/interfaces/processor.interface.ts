import { Readable } from 'stream';
import {
  ImageProcessingOptions,
  ProcessingResult,
  VideoProcessingOptions,
} from '../types';

/**
 * IImageProcessor — contract for image-manipulation backends (ImageMagick/gm).
 */
export interface IImageProcessor {
  /**
   * Process an image: resize, thumbnail, format conversion, metadata strip.
   * @param inputPath  Absolute path to source file on local disk
   * @param outputDir  Directory to write processed artefacts
   * @param options    Processing configuration
   * @returns          Processing result with output paths
   */
  process(
    inputPath: string,
    outputDir: string,
    options: ImageProcessingOptions,
  ): Promise<ImageProcessorOutput>;

  /**
   * Extract basic image dimensions without full decode.
   */
  identify(inputPath: string): Promise<{ width: number; height: number; format: string }>;

  /**
   * Quick health-check — returns true when ImageMagick is available.
   */
  healthCheck(): Promise<boolean>;
}

export interface ImageProcessorOutput {
  /** Path to (possibly converted) primary output */
  primaryPath: string;
  /** Path to generated thumbnail, if requested */
  thumbnailPath?: string;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

/**
 * IVideoProcessor — contract for video-manipulation backends (FFmpeg).
 */
export interface IVideoProcessor {
  /**
   * Process a video: transcode, extract thumbnail frame.
   * @param inputPath  Absolute path to source file on local disk
   * @param outputDir  Directory to write processed artefacts
   * @param options    Processing configuration
   */
  process(
    inputPath: string,
    outputDir: string,
    options: VideoProcessingOptions,
  ): Promise<VideoProcessorOutput>;

  /**
   * Probe a video file to extract codec, duration, and dimension metadata.
   */
  probe(inputPath: string): Promise<VideoProbeResult>;

  /**
   * Quick health-check — returns true when FFmpeg is available.
   */
  healthCheck(): Promise<boolean>;
}

export interface VideoProcessorOutput {
  /** Path to transcoded video, if requested */
  transcodedPath?: string;
  /** Path to extracted thumbnail image, if requested */
  thumbnailPath?: string;
  duration: number;
  width: number;
  height: number;
}

export interface VideoProbeResult {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  fps: number;
  format: string;
}

/**
 * Unified result that can hold either image or video processing output.
 */
export type MediaProcessorOutput =
  | (ImageProcessorOutput & { type: 'image' })
  | (VideoProcessorOutput & { type: 'video' });
