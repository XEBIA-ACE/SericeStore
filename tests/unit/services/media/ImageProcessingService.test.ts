import path from 'path';
import fs from 'fs';
import os from 'os';
import { ImageProcessingService } from '../../../../src/services/media/ImageProcessingService';
import { MediaProcessingError } from '../../../../src/core/errors/AppError';

// ---------------------------------------------------------------------------
// We mock the `gm` module to avoid requiring ImageMagick binaries in CI.
// ---------------------------------------------------------------------------

const mockGmState = {
  resize: jest.fn().mockReturnThis(),
  rotate: jest.fn().mockReturnThis(),
  flip: jest.fn().mockReturnThis(),
  flop: jest.fn().mockReturnThis(),
  type: jest.fn().mockReturnThis(),
  quality: jest.fn().mockReturnThis(),
  setFormat: jest.fn().mockReturnThis(),
  gravity: jest.fn().mockReturnThis(),
  extent: jest.fn().mockReturnThis(),
  write: jest.fn(),
  identify: jest.fn(),
};

jest.mock('gm', () => {
  const gmFn = jest.fn(() => mockGmState);
  gmFn.subClass = jest.fn(() => gmFn);
  return gmFn;
});

describe('ImageProcessingService', () => {
  let service: ImageProcessingService;
  const tmpDir = os.tmpdir();

  beforeEach(() => {
    service = new ImageProcessingService();
    jest.clearAllMocks();
  });

  // ── transform ─────────────────────────────────────────────────────────────

  describe('transform', () => {
    const inputPath = path.join(tmpDir, 'input.jpg');
    const outputPath = path.join(tmpDir, 'output.jpg');

    it('should call write on the gm state and resolve on success', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await expect(
        service.transform(inputPath, outputPath, { width: 800, height: 600 }),
      ).resolves.toBeUndefined();

      expect(mockGmState.write).toHaveBeenCalledWith(outputPath, expect.any(Function));
    });

    it('should reject with MediaProcessingError when ImageMagick fails', async () => {
      const boom = new Error('ImageMagick not found');
      mockGmState.write.mockImplementation((_: string, cb: (err: Error) => void) => cb(boom));

      await expect(
        service.transform(inputPath, outputPath, {}),
      ).rejects.toThrow(MediaProcessingError);
    });

    it('should apply quality when specified', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await service.transform(inputPath, outputPath, { quality: 80 });

      expect(mockGmState.quality).toHaveBeenCalledWith(80);
    });

    it('should apply format when specified', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await service.transform(inputPath, outputPath, { format: 'webp' });

      expect(mockGmState.setFormat).toHaveBeenCalledWith('webp');
    });

    it('should apply rotation', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await service.transform(inputPath, outputPath, { rotate: 90 });

      expect(mockGmState.rotate).toHaveBeenCalledWith('white', 90);
    });

    it('should apply flipX (flop)', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await service.transform(inputPath, outputPath, { flipX: true });

      expect(mockGmState.flop).toHaveBeenCalled();
    });

    it('should apply flipY (flip)', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await service.transform(inputPath, outputPath, { flipY: true });

      expect(mockGmState.flip).toHaveBeenCalled();
    });

    it('should apply greyscale conversion', async () => {
      mockGmState.write.mockImplementation((_: string, cb: (err: null) => void) => cb(null));

      await service.transform(inputPath, outputPath, { greyscale: true });

      expect(mockGmState.type).toHaveBeenCalledWith('Grayscale');
    });
  });

  // ── getMetadata ───────────────────────────────────────────────────────────

  describe('getMetadata', () => {
    it('should parse identify output and return ImageMetadata', async () => {
      const fakeStatSize = 204800;
      jest.spyOn(fs, 'statSync').mockReturnValue({ size: fakeStatSize } as fs.Stats);

      mockGmState.identify.mockImplementation(
        (cb: (err: null, data: unknown) => void) =>
          cb(null, {
            Image: {
              Geometry: '1920x1080+0+0',
              Format: 'JPEG',
              Colorspace: 'sRGB',
            },
          }),
      );

      const meta = await service.getMetadata('/some/photo.jpg');

      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.format).toBe('jpeg');
      expect(meta.colorspace).toBe('sRGB');
      expect(meta.size).toBe(fakeStatSize);
    });

    it('should reject with MediaProcessingError when identify fails', async () => {
      mockGmState.identify.mockImplementation(
        (cb: (err: Error) => void) => cb(new Error('Cannot read image')),
      );

      await expect(service.getMetadata('/bad/path.jpg')).rejects.toThrow(MediaProcessingError);
    });
  });

  // ── tempPath ──────────────────────────────────────────────────────────────

  describe('tempPath', () => {
    it('should return a string ending with the given extension', () => {
      const p = ImageProcessingService.tempPath('.png');
      expect(p).toMatch(/\.png$/);
    });
  });
});
