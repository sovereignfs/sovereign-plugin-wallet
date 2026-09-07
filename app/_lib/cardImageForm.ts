import { generateDek, wrapDekWithCmk } from '@sovereignfs/sdk/e2ee-crypto';
import { encryptBlob, encryptJson } from '@sovereignfs/sdk/e2ee-object';
import type { WrappedDekField } from './actions';
import { compressImageIfNeeded } from './imageCompression';
import { CARD_IMAGE_BUDGET_BYTES, tooLargeMessage } from './mediaTypes';

export type BuiltCardForm = { ok: true; formData: FormData } | { ok: false; error: string };

/** The key material for editing an already-encrypted card — reused, never regenerated. */
export interface ExistingCardKey {
  dek: CryptoKey;
  wrappedDek: WrappedDekField;
}

function presentCardImageSides(formData: FormData): Array<'front' | 'back'> {
  return (['front', 'back'] as const).filter((side) => {
    const file = formData.get(`${side}Image`);
    return file instanceof File && file.size > 0;
  });
}

/** Per-image compression budget — the submission's total split across the sides present. */
function perImageBudget(sides: number): number {
  return sides > 0 ? Math.floor(CARD_IMAGE_BUDGET_BYTES / sides) : CARD_IMAGE_BUDGET_BYTES;
}

/**
 * Builds the FormData a card action receives, doing all client-side work
 * first: compressing oversized images, and — when a key is supplied —
 * encrypting metadata, payload and image bytes before anything leaves the
 * browser.
 *
 * Centralising this is what lets both the create and edit forms fail the
 * *same* way. Previously each duplicated the sequence inline, and an
 * oversized image surfaced as a generic "something went wrong encrypting"
 * regardless of the real cause.
 *
 * - `key` present → edit of an encrypted card: reuse its DEK and wrapped DEK.
 * - `cmk` present, no `key` → encrypt with a freshly generated per-card DEK.
 * - neither → plaintext card; images are still compressed.
 */
export async function buildCardFormData(
  source: FormData,
  cmk: CryptoKey | null,
  key?: ExistingCardKey,
): Promise<BuiltCardForm> {
  const sides = presentCardImageSides(source);
  const budget = perImageBudget(sides.length);

  const compressed = new Map<'front' | 'back', File>();
  for (const side of sides) {
    const file = source.get(`${side}Image`) as File;
    const result = await compressImageIfNeeded(file, budget);
    if (result.size > budget) {
      return { ok: false, error: tooLargeMessage(result.size, budget) };
    }
    compressed.set(side, result);
  }

  let dek: CryptoKey;
  let wrappedDek: WrappedDekField;
  if (key) {
    ({ dek, wrappedDek } = key);
  } else if (cmk) {
    dek = await generateDek();
    wrappedDek = await wrapDekWithCmk(dek, cmk);
  } else {
    // Plaintext card — still compress, but nothing is sealed.
    for (const [side, file] of compressed) source.set(`${side}Image`, file, file.name);
    return { ok: true, formData: source };
  }

  const target = new FormData();
  target.set('barcodeFormat', String(source.get('barcodeFormat') ?? ''));
  target.set('encrypted', 'true');
  target.set(
    'encryptedMetadata',
    JSON.stringify(
      await encryptJson(dek, {
        title: String(source.get('title') ?? '').trim(),
        issuer: String(source.get('issuer') ?? '').trim(),
        notes: String(source.get('notes') ?? '').trim(),
      }),
    ),
  );
  target.set(
    'encryptedPayload',
    JSON.stringify(await encryptJson(dek, String(source.get('payload') ?? '').trim())),
  );
  target.set('wrappedDek', JSON.stringify(wrappedDek));

  for (const [side, file] of compressed) {
    const encrypted = await encryptBlob(dek, file);
    target.set(`${side}Image`, encrypted.ciphertext, `${side}.bin`);
    target.set(`${side}ImageIv`, encrypted.iv);
    target.set(`${side}ImageAlgorithmVersion`, encrypted.algorithmVersion);
    target.set(`${side}ImageContentType`, file.type);
  }

  return { ok: true, formData: target };
}
