import { VideoProcessingService } from '../../../../src/services/media/VideoProcessingService';
import { MediaProcessingError } from '../../../../src/core/errors/AppError';

// ---------------------------------------------------------------------------
// Mock fluent-ffmpeg so tests run without real FFmpeg binaries.
// ---------------------------------------------------------------------------

const mockFFmpegInstance = {
  videoCodec: jest.fn().mockReturnThis(),
  audioCodec: jest.fn().mockReturnThis(),
  videoBitrate: jest.fn().mockReturnThis(),
  audioBitrate: jest.fn().mockReturnThis(),
  fps: jest.fn().mockReturnThis(),
  format: jest.fn().mockReturnThis(),
  size: jest.fn().mockReturnThis(),
  seekInput: jest.fn().mockReturnThis(),
  frames: jest.fn().mockReturnThis(),
  outputFormat: jest.fn().mockReturnThis(),
  outputOption: jest.fn().mockReturnThis(),
  output: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
  save: jest.fn(),
  run: jest.fn(),
};

const ffmpegMock = jest.fn(() => mockFFmpegInstance);
(ffmpegMock as unknown as { setFfmpegPath: jest.Mock; setFfprobePath: jest.Mock; ffprobe: jest.Mock }).setFfmpegPath = jest.fn();
(ffmpegMock as unknown as { setFfmpegPath: jest.Mock; setFfprobePath: jest.Mock; ffprobe: jest.Mock }).setFfprobePath = jest.fn();
(ffmpegMock as unknown as { setFfmpegPath: jest.Mock; setFfprobePath: jest.Mock; ffprobe: jest.Mock }).ffprobe = jest.fn();

jest.mock('fluent-ffmpeg', () => ffmpegMock);

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;

  beforeEach(() => {
    service = new VideoProcessingService();
    jest.clearAllMocks();
  });

  // ── transcode ─────────────────────────────────────────────────────────────

  describe('transcode', () => {
    it('should resolve when FFmpeg triggers the "end" event', async () => {
      mockFFmpegInstance.on.mockImplementation(function (
        this: typeof mockFFmpegInstance,
        event: string,
        cb: () => void,
      ) {
        if (event === 'end') setTimeout(cb, 0);
        return this;
      });
      mockFFmpegInstance.save.mockImplementation(() => undefined);

      await expect(
        service.transcode('/input.mp4', '/output.mp4', { format: 'mp4', videoCodec: 'libx264' }),
      ).resolves.toBeUndefined();

      expect(mockFFmpegInstance.videoCodec).toHaveBeenCalledWith('libx264');
      expect(mockFFmpegInstance.format).toHaveBeenCalledWith('mp4');
    });

    it('should reject with MediaProcessingError when FFmpeg errors', async () => {
      const boom = new Error('FFmpeg crash');
      mockFFmpegInstance.on.mockImplementation(function (
        this: typeof mockFFmpegInstance,
        event: string,
        cb: (err: Error) => void,
      ) {
        if (event === 'error') setTimeout(() => cb(boom), 0);
        return this;
      });

      await expect(
        service.transcode('/bad.mp4', '/out.mp4', {}),
      ).rejects.toThrow(MediaProcessingError);
    });
  });

  // ── getMetadata ───────────────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('should parse ffprobe output and return VideoMetadata', async () => {
      const probeData = {
        format: {
          duration: '120.5',
          bit_rate: '1000000',
          size: '15000000',
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            r_frame_rate: '30/1',
          },
          {
            codec_type: 'audio',
            codec_name: 'aac',
          },
        ],
      };

      (ffmpegMock as unknown as { ffprobe: jest.Mock }).ffprobe.mockImplementation(
        (_path: string, cb: (err: null, data: unknown) => void) => cb(null, probeData),
      );

      const meta = await service.getMetadata('/video.mp4');

      expect(meta.duration).toBeCloseTo(120.5);
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.fps).toBe(30);
      expect(meta.videoCodec).toBe('h264');
      expect(meta.audioCodec).toBe('aac');
    });

    it('should reject with MediaProcessingError when ffprobe fails', async () => {
      (ffmpegMock as unknown as { ffprobe: jest.Mock }).ffprobe.mockImplementation(
        (_path: string, cb: (err: Error) => void) => cb(new Error('file not found')),
      );

      await expect(service.getMetadata('/ghost.mp4')).rejects.toThrow(MediaProcessingError);
    });
  });
});
