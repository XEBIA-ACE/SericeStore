import { resolveFileCategory, isAllowedMimeType, sanitiseKey, validate, listQuerySchema } from '../../../src/utils/validators';

describe('resolveFileCategory', () => {
  it('returns "image" for image MIME types', () => {
    expect(resolveFileCategory('image/jpeg')).toBe('image');
    expect(resolveFileCategory('image/png')).toBe('image');
    expect(resolveFileCategory('image/webp')).toBe('image');
  });

  it('returns "video" for video MIME types', () => {
    expect(resolveFileCategory('video/mp4')).toBe('video');
    expect(resolveFileCategory('video/webm')).toBe('video');
  });

  it('returns "document" for document MIME types', () => {
    expect(resolveFileCategory('application/pdf')).toBe('document');
    expect(resolveFileCategory('text/plain')).toBe('document');
  });

  it('returns "other" for unrecognised MIME types', () => {
    expect(resolveFileCategory('application/octet-stream')).toBe('other');
    expect(resolveFileCategory('application/zip')).toBe('other');
  });
});

describe('isAllowedMimeType', () => {
  it('returns true for allowed types', () => {
    expect(isAllowedMimeType('image/jpeg')).toBe(true);
    expect(isAllowedMimeType('video/mp4')).toBe(true);
    expect(isAllowedMimeType('application/pdf')).toBe(true);
  });

  it('returns false for disallowed types', () => {
    expect(isAllowedMimeType('application/zip')).toBe(false);
    expect(isAllowedMimeType('application/x-executable')).toBe(false);
  });
});

describe('sanitiseKey', () => {
  it('removes leading slashes', () => {
    expect(sanitiseKey('/images/test.jpg')).toBe('images/test.jpg');
    expect(sanitiseKey('///deep/path')).toBe('deep/path');
  });

  it('removes path traversal sequences', () => {
    expect(sanitiseKey('../../../etc/passwd')).toBe('etc/passwd');
    expect(sanitiseKey('images/../../../secret')).toBe('images/secret');
  });

  it('replaces invalid characters with underscores', () => {
    expect(sanitiseKey('my file name.jpg')).toBe('my_file_name.jpg');
    expect(sanitiseKey('file@name!.png')).toBe('file_name_.png');
  });

  it('preserves valid path characters', () => {
    expect(sanitiseKey('images/2024/photo-001.jpg')).toBe('images/2024/photo-001.jpg');
  });
});

describe('validate', () => {
  it('returns parsed value for valid input', () => {
    const { value, error } = validate(listQuerySchema, { maxKeys: '50' });
    expect(error).toBeUndefined();
    expect(value.maxKeys).toBe(50);
  });

  it('returns default values for missing optional fields', () => {
    const { value } = validate(listQuerySchema, {});
    expect(value.maxKeys).toBe(100);
  });

  it('returns error string for invalid input', () => {
    const { error } = validate(listQuerySchema, { maxKeys: '99999' });
    expect(error).toBeDefined();
    expect(error).toContain('maxKeys');
  });
});
