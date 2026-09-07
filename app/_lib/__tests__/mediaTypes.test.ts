import { describe, expect, it } from 'vitest';
import {
  OPAQUE_CONTENT_TYPE,
  formatBytes,
  isAllowedImageType,
  safeBlobContentType,
  safeImageContentType,
  tooLargeMessage,
} from '../mediaTypes';

describe('safeImageContentType', () => {
  it('keeps a genuine image type', () => {
    expect(safeImageContentType('image/png')).toBe('image/png');
    expect(safeImageContentType('image/jpeg')).toBe('image/jpeg');
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(safeImageContentType('  IMAGE/PNG ')).toBe('image/png');
  });

  it.each([
    'text/html',
    'image/svg+xml', // scriptable, deliberately not on the allowlist
    'application/xhtml+xml',
    'text/javascript',
    '',
    null,
    undefined,
  ])('degrades %s to the opaque type', (input) => {
    // The signed-download route echoes the stored contentType straight into
    // a `Content-Type` header with no `Content-Disposition`, and it sits
    // outside the proxy's CSP — so anything renderable-and-scriptable must
    // never survive this function.
    expect(safeImageContentType(input)).toBe(OPAQUE_CONTENT_TYPE);
  });

  it('treats a type with parameters as untrusted', () => {
    expect(safeImageContentType('text/html; charset=utf-8')).toBe(OPAQUE_CONTENT_TYPE);
  });
});

describe('safeBlobContentType', () => {
  it('applies the same allowlist, since a blob: URL inherits this origin', () => {
    expect(safeBlobContentType('image/webp')).toBe('image/webp');
    expect(safeBlobContentType('text/html')).toBe(OPAQUE_CONTENT_TYPE);
  });
});

describe('isAllowedImageType', () => {
  it('accepts only the curated image list', () => {
    expect(isAllowedImageType('image/avif')).toBe(true);
    expect(isAllowedImageType('image/svg+xml')).toBe(false);
  });
});

describe('size messages', () => {
  it('formats KB and MB', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('names both the actual size and the limit so the user can act', () => {
    const message = tooLargeMessage(2 * 1024 * 1024, 700 * 1024);
    expect(message).toContain('2.0 MB');
    expect(message).toContain('700 KB');
  });
});
