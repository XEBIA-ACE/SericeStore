/**
 * Options shared by all image transformation operations.
 */
export interface ImageTransformOptions {
  /** Target width in pixels */
  width?: number;
  /** Target height in pixels */
  height?: number;
  /** Resize strategy when both dimensions are supplied */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  /** Output format */
  format?: 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff';
  /** JPEG/WebP quality 1-100 */
  quality?: number;
  /** Rotation in degrees (90 | 180 | 270) */
  rotate?: number;
  /** Flip horizontally */
  flipX?: boolean;
  /** Flip vertically */
  flipY?: boolean;
  /** Convert to greyscale */
  greyscale?: boolean;
}

/**
 * Metadata extracted from an image file.
 */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  colorspace: string;
  size: number;
  density?: { width: number; height: number };
  hasAlpha?: boolean;
}

/**
 * Options for video transcoding.
 */
export interface VideoTranscodeOptions {
  /** Target container format (e.g. 'mp4', 'webm', 'mkv') */
  format?: string;
  /** Video codec (e.g. 'libx264', 'libvpx-vp9') */
  videoCodec?: string;
  /** Audio codec (e.g. 'aac', 'libopus') */
  audioCodec?: string;
  /** Target video bitrate (e.g. '1000k') */
  videoBitrate?: string;
  /** Target audio bitrate (e.g. '128k') */
  audioBitrate?: string;
  /** Frames per second */
  fps?: number;
  /** Output width */
  width?: number;
  /** Output height */
  height?: number;
}

/**
 * Metadata extracted from a video/audio file.
 */
export interface VideoMetadata {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  size: number;
  format: string;
}

/**
 * Options for thumbnail generation from a video.
 */
export interface ThumbnailOptions {
  /** Timestamp in seconds to capture (default: 0) */
  timestamp?: number;
  /** Thumbnail width */
  width?: number;
  /** Thumbnail height */
  height?: number;
  /** Output format */
  format?: 'jpeg' | 'png';
}

/**
 * Contract for image processing operations (backed by ImageMagick).
 */
export interface IImageProcessor {
  /** Transform an image and write the result to outputPath */
  transform(inputPath: string, outputPath: string, options: ImageTransformOptions): Promise<void>;

  /** Extract metadata from an image file */
  getMetadata(inputPath: string): Promise<ImageMetadata>;
}

/**
 * Contract for video/audio processing operations (backed by FFmpeg).
 */
export interface IVideoProcessor {
  /** Transcode a video/audio file */
  transcode(inputPath: string, outputPath: string, options: VideoTranscodeOptions): Promise<void>;

  /** Extract a single video frame as an image */
  extractThumbnail(inputPath: string, outputPath: string, options?: ThumbnailOptions): Promise<void>;

  /** Extract metadata from a video/audio file */
  getMetadata(inputPath: string): Promise<VideoMetadata>;
}
