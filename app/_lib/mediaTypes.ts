/**
 * Media-type and size limits for everything Wallet stores.
 *
 * **Why the allowlist matters.** `sdk.storage` records whatever
 * `contentType` a plugin hands it, and the signed-download route
 * (`runtime/app/api/storage/[token]/route.ts`) echoes that value verbatim
 * into the response `Content-Type` with no `Content-Disposition` — and that
 * route sits outside the proxy's matcher, so the nonce-based CSP is never
 * applied to it. A browser-supplied `file.type` of `text/html` would
 * therefore be served as an HTML document on the runtime's own origin with
 * no CSP. `accept="image/*"` on the input is a picker filter, not a
 * guarantee, so the type is validated server-side before it is stored.
 *
 * The encrypted paths were already safe (they store the opaque
 * `application/octet-stream` and keep the real type inside encrypted
 * metadata) — but that metadata is client-supplied too, and it is used to
 * rebuild a `Blob` whose object URL inherits this origin, so it goes through
 * the same allowlist on the way out.
 */

/** Image types accepted for card front/back images and rendered inline. */
const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/** The type stored for anything not on the inline-renderable allowlist. */
export const OPAQUE_CONTENT_TYPE = 'application/octet-stream';

function normalize(contentType: string | null | undefined): string {
  return typeof contentType === 'string' ? contentType.toLowerCase().trim() : '';
}

export function isAllowedImageType(contentType: string | null | undefined): boolean {
  return IMAGE_TYPES.has(normalize(contentType));
}

/**
 * The type safe to hand to `sdk.storage` (and therefore to the signed-download
 * route) for a card image. Anything not a known image type degrades to the
 * opaque type rather than being rejected — the bytes are still stored, they
 * just never render as an active document.
 */
export function safeImageContentType(contentType: string | null | undefined): string {
  const normalized = normalize(contentType);
  return IMAGE_TYPES.has(normalized) ? normalized : OPAQUE_CONTENT_TYPE;
}

/**
 * The type safe to give a client-side `Blob` before calling
 * `URL.createObjectURL`. A `blob:` URL inherits the creating document's
 * origin, so an attacker-chosen `text/html` here would be same-origin
 * scriptable — only genuinely renderable image types keep their real type.
 */
export function safeBlobContentType(contentType: string | null | undefined): string {
  return safeImageContentType(contentType);
}

/**
 * Server Actions cap the whole request body. `runtime/next.config.ts` sets no
 * `experimental.serverActions.bodySizeLimit`, so Next's built-in default of
 * **1 MB** applies to every submission — image bytes, encrypted metadata,
 * wrapped DEK, payload, notes and multipart framing combined.
 *
 * These budgets leave headroom under that ceiling instead of crowding it:
 * a submission that fits the budget still has ~300 KB of slack for the rest
 * of the form.
 */
export const MAX_REQUEST_BUDGET_BYTES = 700 * 1024;

/** Total budget shared across whichever card images are in one submission. */
export const CARD_IMAGE_BUDGET_BYTES = MAX_REQUEST_BUDGET_BYTES;

/** Ceiling for a single document upload, measured on the encrypted bytes. */
export const MAX_DOCUMENT_BYTES = MAX_REQUEST_BUDGET_BYTES;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * The message shown when a file is too large to submit. Names the actual
 * sizes so the user can act on it, rather than "something went wrong".
 */
export function tooLargeMessage(actual: number, limit: number): string {
  return `That file is ${formatBytes(actual)}, over the ${formatBytes(limit)} limit. Try a smaller image or a lower-resolution scan.`;
}
