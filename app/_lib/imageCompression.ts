/**
 * Client-side downscale/recompress for oversized images before client-side
 * encryption + upload. Server Actions cap the whole request body at a fixed
 * size — Next's built-in 1 MB default, since `runtime/next.config.ts` sets no
 * `experimental.serverActions.bodySizeLimit` — and camera photos from
 * iOS/Android PWAs routinely exceed it on their own, let alone alongside a
 * second image in the same submission.
 *
 * **Only oversized images are touched.** A file already under `maxBytes`
 * passes through byte-for-byte, so a scan that fits is stored exactly as the
 * user provided it. Re-encoding is a last resort to make an upload possible
 * at all, not a routine step — which matters for a document snapshot, where
 * silently transcoding a lossless PNG scan to 50%-quality JPEG would destroy
 * detail the user may need.
 */

const MAX_DIMENSION_PX = 2000;
const DEFAULT_MAX_BYTES = 700 * 1024;
const MIN_QUALITY = 0.5;
const QUALITY_STEP = 0.1;

export interface CompressionOutcome {
  file: File;
  /** True when the bytes were re-encoded rather than passed through unchanged. */
  recompressed: boolean;
}

export async function compressImageIfNeeded(
  file: File,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<File> {
  return (await compressImageWithOutcome(file, maxBytes)).file;
}

/**
 * As `compressImageIfNeeded`, but reports whether re-encoding actually
 * happened so a caller can tell the user their image was changed.
 */
export async function compressImageWithOutcome(
  file: File,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<CompressionOutcome> {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) {
    return { file, recompressed: false };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Unsupported/corrupt image — let the upload attempt surface whatever
    // error follows, or the caller's size check reject it with a real message.
    return { file, recompressed: false };
  }

  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { file, recompressed: false };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob: Blob | null = null;
  for (let quality = 0.92; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) break;
  }
  if (!blob || blob.size >= file.size) {
    return { file, recompressed: false }; // compression didn't help — keep the original
  }

  return {
    file: new File([blob], replaceExtension(file.name, 'jpg'), { type: 'image/jpeg' }),
    recompressed: true,
  };
}

function replaceExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot === -1 ? name : name.slice(0, dot)}.${ext}`;
}
