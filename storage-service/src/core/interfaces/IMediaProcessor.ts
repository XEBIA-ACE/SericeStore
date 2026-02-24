import { ProcessedImage, ProcessedVideo } from '../entities/StoredObject';

export interface ImageProcessingOptions {
  /** Target width in pixels (0 = auto) */
  width?: number;
  /** Target height in pixels (0 = auto) */
  height?: number;
  /** JPEG/WebP quality 1–100 */
  quality?: number;
  /** Output format override */
  format?: 'jpeg' | 'png' | 'webp' | 'tiff';
  /** Whether to generate a thumbnail */
  generateThumbnail?: boolean;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

export interface VideoProcessingOptions {
  /** Output video codec */
  codec?: string;
  /** Output audio codec */
  audioCodec?: string;
  /** Output container format */
  format?: string;
  /** Target width */
  width?: number;
  /** Target height */
  height?: number;
  /** Frames per second */
  fps?: number;
  /** Video bitrate (e.g. '1000k') */
  videoBitrate?: string;
  /** Audio bitrate (e.g. '128k') */
  audioBitrate?: string;
}

/**
 * Port that both ImageMagick and FFmpeg adapters implement.
 */
export interface IImageProcessor {
  /**
   * Process an image buffer (resize, convert, generate thumbnail).
   * Returns keyed paths that callers must then store.
   */
  process(
    buffer: Buffer,
    outputKey: string,
    options?: ImageProcessingOptions,
  ): Promise<{ processedBuffer: Buffer; thumbnailBuffer?: Buffer; metadata: ProcessedImage }>;

  /**
   * Extract basic metadata (width, height, format) without transforming.
   */
  getMetadata(buffer: Buffer): Promise<Pick<ProcessedImage, 'width' | 'height' | 'format' | 'size'>>;
}

export interface IVideoProcessor {
  /**
   * Transcode a video file (given by local temp path).
   * Returns the local temp path of the transcoded file.
   */
  transcode(
    inputPath: string,
    outputPath: string,
    options?: VideoProcessingOptions,
  ): Promise<ProcessedVideo>;

  /**
   * Extract thumbnail frame from a video at a given timestamp (seconds).
   */
  extractThumbnail(
    inputPath: string,
    outputPath: string,
    timestampSeconds?: number,
  ): Promise<Buffer>;

  /**
   * Get video metadata (duration, codec, resolution).
   */
  getMetadata(
    inputPath: string,
  ): Promise<Pick<ProcessedVideo, 'duration' | 'width' | 'height' | 'format' | 'codec'>>;
}
