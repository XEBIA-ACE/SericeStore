/**
 * Unit tests for ImageProcessor.
 *
 * sharp is a native addon; we mock it here to avoid requiring a real build.
 * Integration-level image processing is tested in tests/integration/.
 */

jest.mock('sharp', () => {
  const chain: Record<string, jest.Mock> = {};
  const mockSharp = jest.fn(() => chain);

  const methods = ['resize', 'jpeg', 'png', 'webp', 'tiff', 'rotate', 'toFile'];
  methods.forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });

  chain.toBuffer = jest.fn().mockResolvedValue(Buffer.from('processed-image'));
  chain.metadata = jest.fn().mockResolvedValue({
    width: 800,
    height: 600,
    format: 'jpeg',
  });

  return mockSharp;
});

import { ImageProcessor } from '../../../src/services/media/ImageProcessor';

describe('ImageProcessor', () => {
  let processor: ImageProcessor;

  beforeEach(() => {
    processor = new ImageProcessor();
    jest.clearAllMocks();
  });

  it('should process an image and return a buffer', async () => {
    const input = Buffer.from('raw-image');
    const { processedBuffer, metadata } = await processor.process(input, 'images/out.jpg');

    expect(processedBuffer).toBeInstanceOf(Buffer);
    expect(processedBuffer.length).toBeGreaterThan(0);
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.format).toBeDefined();
  });

  it('should generate a thumbnail buffer when generateThumbnail=true', async () => {
    const input = Buffer.from('raw-image');
    const { thumbnailBuffer } = await processor.process(input, 'images/out.jpg', {
      generateThumbnail: true,
    });

    expect(thumbnailBuffer).toBeInstanceOf(Buffer);
  });

  it('should not generate a thumbnail when generateThumbnail=false', async () => {
    const input = Buffer.from('raw-image');
    const { thumbnailBuffer } = await processor.process(input, 'images/out.jpg', {
      generateThumbnail: false,
    });

    expect(thumbnailBuffer).toBeUndefined();
  });

  it('should return metadata without transforming', async () => {
    const input = Buffer.from('raw-image');
    const meta = await processor.getMetadata(input);

    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    expect(meta.format).toBe('jpeg');
    expect(meta.size).toBeGreaterThan(0);
  });
});
