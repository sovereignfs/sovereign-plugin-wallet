'use server';

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import { walletCardPayloads, walletItems } from '../_db/schema';
import { parseCardMetadata, serializeCardMetadata } from './cardMetadata';
import { formString, now, parseJsonOrNull } from './formUtils';
import { ACTION_OK, guarded } from './actionResult';
import type { ActionResult, CreateResult } from './actionResult';
import { CARD_IMAGE_BUDGET_BYTES, safeImageContentType, tooLargeMessage } from './mediaTypes';

/**
 * `sdk.db.getClient()` is typed `unknown` (dialect-agnostic contract). The
 * SQLite query-builder type is the right cast on **both** dialects: the
 * client's dialect is bound to the connection, not to the table object passed
 * to `.from()`/`.insert()`, so a `sqliteTable()` schema queries correctly
 * against a Postgres-backed client as long as the physical Postgres columns
 * serialize identically (plain `integer` for booleans/timestamps — see
 * `db/schema.postgres.ts` and `docs/plugin-database.md`). Wallet is
 * `type: "sovereign"`, so it gets a dedicated store on whichever dialect the
 * instance runs; there is no per-plugin dialect choice.
 */
type Db = BaseSQLiteDatabase<'async', unknown>;

const BARCODE_FORMATS = ['qr', 'code128', 'code39', 'ean13', 'upc', 'other'] as const;
export type BarcodeFormat = (typeof BARCODE_FORMATS)[number];

/** Opaque ciphertext + IV, matching `EncryptedJson` from `@sovereignfs/sdk/e2ee-object`. */
export interface EncryptedField {
  ciphertext: string;
  iv: string;
  algorithmVersion: string;
}

/** Opaque wrapped DEK, matching `WrappedDek` from `@sovereignfs/sdk/e2ee-crypto`. */
export interface WrappedDekField {
  wrappedDek: string;
  algorithmVersion: string;
}

export interface CardListItem {
  id: string;
  encrypted: boolean;
  /** Empty for an encrypted card — the server never decrypts; only the client may, once unlocked. */
  title: string;
  issuer: string;
  barcodeFormat: string | null;
  createdAt: number;
  updatedAt: number;
  /** Populated when `encrypted`, so the list view can decrypt title/issuer client-side (RFC 0060); `null` otherwise. */
  cipher: {
    encryptedMetadata: EncryptedField;
    wrappedDek: WrappedDekField;
  } | null;
}

/**
 * A card image (W-15). `iv`/`algorithmVersion` are non-null only when the
 * card itself is encrypted — the image then travels as ciphertext under the
 * card's own DEK, decrypted client-side same as the payload/metadata. When
 * the card is unencrypted, `downloadUrl` is directly usable in `<img src>`.
 */
export interface CardImage {
  downloadUrl: string;
  iv: string | null;
  algorithmVersion: string | null;
  /** The original image MIME type, needed to reconstruct a renderable `Blob` after decrypting. */
  contentType: string | null;
}

export interface CardDetail {
  id: string;
  encrypted: boolean;
  barcodeFormat: string | null;
  createdAt: number;
  updatedAt: number;
  /** Populated when `!encrypted`; empty otherwise — decryption happens client-side. */
  title: string;
  issuer: string;
  notes: string;
  payload: string;
  frontImage: CardImage | null;
  backImage: CardImage | null;
  /** Populated when `encrypted`; `null` otherwise. */
  cipher: {
    encryptedMetadata: EncryptedField;
    encryptedPayload: EncryptedField;
    wrappedDek: WrappedDekField;
  } | null;
}

async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

/**
 * Resolves a stored `sdk.storage` image key into a signed URL + (if
 * encrypted) its cipher metadata. Degrades to `null` (no image) rather than
 * throwing if the object is missing — `getSignedUrl()` throws for a
 * nonexistent key, which would otherwise 500 the whole card page over one
 * missing image (W-17 locked-state/edge-case hardening).
 */
async function resolveCardImage(key: string | null, encrypted: boolean): Promise<CardImage | null> {
  if (!key) return null;
  const object = await sdk.storage.get(key);
  if (!object) return null;

  if (!encrypted) {
    const downloadUrl = await sdk.storage.getSignedUrl(key, { expiresInSeconds: 300 });
    return { downloadUrl, iv: null, algorithmVersion: null, contentType: object.contentType };
  }

  const blobMeta = object.metadata as
    | { iv?: string; blobAlgorithmVersion?: string; contentType?: string }
    | null;
  // Missing cipher metadata means the bytes can't be decrypted — treat as
  // absent rather than 500ing, same as a missing object.
  if (!blobMeta?.iv || !blobMeta.blobAlgorithmVersion) return null;
  const downloadUrl = await sdk.storage.getSignedUrl(key, { expiresInSeconds: 300 });
  return {
    downloadUrl,
    iv: blobMeta.iv,
    algorithmVersion: blobMeta.blobAlgorithmVersion,
    contentType: blobMeta.contentType ?? null,
  };
}

export async function listCards(): Promise<CardListItem[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({
      id: walletItems.id,
      encryptedMetadata: walletItems.encryptedMetadata,
      encryptionVersion: walletItems.encryptionVersion,
      wrappedDek: walletItems.wrappedDek,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt,
      barcodeFormat: walletCardPayloads.barcodeFormat,
    })
    .from(walletItems)
    .leftJoin(walletCardPayloads, eq(walletCardPayloads.itemId, walletItems.id))
    .where(
      and(
        eq(walletItems.tenantId, tenantId),
        eq(walletItems.ownerUserId, userId),
        eq(walletItems.kind, 'card'),
      ),
    )
    .orderBy(desc(walletItems.updatedAt));

  return rows.map((row) => {
    const encrypted = row.encryptionVersion !== null;
    // The server never decrypts — only plaintext title/issuer are ever assembled here.
    const metadata = encrypted
      ? { title: '', issuer: '' }
      : parseCardMetadata(row.encryptedMetadata);
    const encryptedMetadata = encrypted
      ? parseJsonOrNull<EncryptedField>(row.encryptedMetadata)
      : null;
    const wrappedDek = encrypted ? parseJsonOrNull<WrappedDekField>(row.wrappedDek) : null;
    return {
      id: row.id,
      encrypted,
      title: metadata.title,
      issuer: metadata.issuer,
      barcodeFormat: row.barcodeFormat,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      cipher: encryptedMetadata && wrappedDek ? { encryptedMetadata, wrappedDek } : null,
    };
  });
}

export async function getCard(cardId: string): Promise<CardDetail | null> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({
      id: walletItems.id,
      encryptedMetadata: walletItems.encryptedMetadata,
      encryptionVersion: walletItems.encryptionVersion,
      wrappedDek: walletItems.wrappedDek,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt,
      barcodeFormat: walletCardPayloads.barcodeFormat,
      payload: walletCardPayloads.payload,
      frontImageKey: walletCardPayloads.frontImageKey,
      backImageKey: walletCardPayloads.backImageKey,
    })
    .from(walletItems)
    .innerJoin(walletCardPayloads, eq(walletCardPayloads.itemId, walletItems.id))
    .where(
      and(
        eq(walletItems.id, cardId),
        eq(walletItems.tenantId, tenantId),
        eq(walletItems.ownerUserId, userId),
        eq(walletItems.kind, 'card'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const encrypted = row.encryptionVersion !== null;
  const [frontImage, backImage] = await Promise.all([
    resolveCardImage(row.frontImageKey, encrypted),
    resolveCardImage(row.backImageKey, encrypted),
  ]);

  if (encrypted) {
    // A row whose encryption columns don't parse is inconsistent, not fatal:
    // returning `cipher: null` lets the detail view render its
    // "couldn't decrypt" state instead of throwing a 500 the user can never
    // clear. (Reachable if a plaintext update ever raced an encrypted one.)
    const encryptedMetadata = parseJsonOrNull<EncryptedField>(row.encryptedMetadata);
    const encryptedPayload = parseJsonOrNull<EncryptedField>(row.payload);
    const wrappedDek = parseJsonOrNull<WrappedDekField>(row.wrappedDek);
    return {
      id: row.id,
      encrypted: true,
      title: '',
      issuer: '',
      notes: '',
      payload: '',
      barcodeFormat: row.barcodeFormat,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      frontImage,
      backImage,
      cipher:
        encryptedMetadata && encryptedPayload && wrappedDek
          ? { encryptedMetadata, encryptedPayload, wrappedDek }
          : null,
    };
  }

  const metadata = parseCardMetadata(row.encryptedMetadata);
  return {
    id: row.id,
    encrypted: false,
    title: metadata.title,
    issuer: metadata.issuer,
    notes: metadata.notes,
    barcodeFormat: row.barcodeFormat,
    payload: row.payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    frontImage,
    backImage,
    cipher: null,
  };
}

/** The client-encrypted fields a form submits when the card is encrypted. */
interface EncryptedCardFields {
  encryptedMetadata: string;
  encryptedPayload: string;
  wrappedDek: WrappedDekField;
}

/**
 * Validates the client-encrypted fields, returning `null` when any are
 * missing or malformed. The caller turns that into a result — this never
 * throws, so a truncated submission is a message, not a 500.
 */
function encryptedFormFields(formData: FormData): EncryptedCardFields | null {
  const encryptedMetadata = formString(formData, 'encryptedMetadata');
  const encryptedPayload = formString(formData, 'encryptedPayload');
  const wrappedDek = parseJsonOrNull<WrappedDekField>(formString(formData, 'wrappedDek'));
  if (!encryptedMetadata || !encryptedPayload || !wrappedDek?.algorithmVersion) return null;
  return { encryptedMetadata, encryptedPayload, wrappedDek };
}

function barcodeFormatFrom(formData: FormData): string {
  const raw = formString(formData, 'barcodeFormat');
  return (BARCODE_FORMATS as readonly string[]).includes(raw) ? raw : 'other';
}

/** A card image parsed off the form, validated but not yet uploaded. */
interface PendingImage {
  side: 'front' | 'back';
  file: File;
  iv: string;
  algorithmVersion: string;
  contentType: string;
}

/**
 * Reads and validates the optional `${side}Image` files without touching
 * storage. Validation runs before any upload so a rejected submission never
 * leaves orphaned objects counting against the user's quota — the failure
 * mode W-17 fixed in `updateCard` but not in `createCard`.
 */
function readPendingImages(formData: FormData): { images: PendingImage[] } | { error: string } {
  const images: PendingImage[] = [];
  let total = 0;
  for (const side of ['front', 'back'] as const) {
    const file = formData.get(`${side}Image`);
    if (!(file instanceof File) || file.size === 0) continue;
    total += file.size;
    if (total > CARD_IMAGE_BUDGET_BYTES) {
      return { error: tooLargeMessage(total, CARD_IMAGE_BUDGET_BYTES) };
    }
    images.push({
      side,
      file,
      iv: formString(formData, `${side}ImageIv`),
      algorithmVersion: formString(formData, `${side}ImageAlgorithmVersion`),
      contentType: formString(formData, `${side}ImageContentType`),
    });
  }
  return { images };
}

/**
 * Uploads a validated image via `sdk.storage` (W-15). An encrypted card's
 * bytes arrive already encrypted, with their IV/algorithm stored as opaque
 * storage metadata; the declared content type is allowlisted either way
 * before it can reach the signed-download route's `Content-Type` header
 * (see `mediaTypes.ts`).
 */
async function uploadCardImage(image: PendingImage, ownerUserId: string): Promise<string> {
  const key = `cards/${randomUUID()}`;
  const encrypted = Boolean(image.iv);
  await sdk.storage.put({
    key,
    body: image.file,
    contentType: encrypted
      ? 'application/octet-stream'
      : safeImageContentType(image.file.type),
    ownerUserId,
    metadata: encrypted
      ? {
          iv: image.iv,
          blobAlgorithmVersion: image.algorithmVersion,
          contentType: safeImageContentType(image.contentType),
        }
      : null,
  });
  return key;
}

/** Best-effort cleanup of objects uploaded for a write that then failed. */
async function discardUploads(keys: Array<string | undefined>): Promise<void> {
  await Promise.all(
    keys.filter((key): key is string => Boolean(key)).map((key) => sdk.storage.delete(key).catch(() => undefined)),
  );
}

interface PlaintextCardFields {
  title: string;
  issuer: string;
  notes: string;
  payload: string;
}

/**
 * What a create/update is about to write, in whichever of the two forms the
 * submission takes. Discriminating on `encrypted` here is what lets both
 * branches below read their fields without any non-null assertions.
 */
type CardWrite =
  | { encrypted: true; fields: EncryptedCardFields }
  | { encrypted: false; fields: PlaintextCardFields };

/** Validates the whole submission before anything is uploaded or written. */
function resolveCardWrite(formData: FormData): CardWrite | { error: string } {
  if (formString(formData, 'encrypted') === 'true') {
    const fields = encryptedFormFields(formData);
    if (!fields) return { error: 'This card could not be encrypted. Please try again.' };
    return { encrypted: true, fields };
  }
  const title = formString(formData, 'title');
  if (!title) return { error: 'Display name is required.' };
  const payload = formString(formData, 'payload');
  if (!payload) return { error: 'Card payload is required.' };
  return {
    encrypted: false,
    fields: {
      title,
      payload,
      issuer: formString(formData, 'issuer'),
      notes: formString(formData, 'notes'),
    },
  };
}

/** The `wallet_items` columns a write sets, derived from its resolved form. */
function itemEncryptionColumns(write: CardWrite) {
  return write.encrypted
    ? {
        encryptedMetadata: write.fields.encryptedMetadata,
        encryptionVersion: write.fields.wrappedDek.algorithmVersion,
        wrappedDek: JSON.stringify(write.fields.wrappedDek),
      }
    : {
        encryptedMetadata: serializeCardMetadata(write.fields),
        // Both columns are always written, never left over from a previous
        // state. Leaving `encryptionVersion` set on a now-plaintext row made
        // `getCard` read the plaintext payload as ciphertext — an
        // unrecoverable detail page for that card.
        encryptionVersion: null,
        wrappedDek: null,
      };
}

function payloadColumn(write: CardWrite): string {
  return write.encrypted ? write.fields.encryptedPayload : write.fields.payload;
}

export async function createCard(formData: FormData): Promise<CreateResult> {
  return guarded(async () => {
    const { db, userId, tenantId } = await getContext();
    const barcodeFormat = barcodeFormatFrom(formData);

    // Validate everything before the first upload.
    const pending = readPendingImages(formData);
    if ('error' in pending) return { ok: false as const, error: pending.error };
    const write = resolveCardWrite(formData);
    if ('error' in write) return { ok: false as const, error: write.error };

    const itemId = randomUUID();
    const ts = now();
    const uploaded = await Promise.all(
      pending.images.map(async (image) => ({
        side: image.side,
        key: await uploadCardImage(image, userId),
      })),
    );
    const frontImageKey = uploaded.find((u) => u.side === 'front')?.key ?? null;
    const backImageKey = uploaded.find((u) => u.side === 'back')?.key ?? null;

    try {
      await db.insert(walletItems).values({
        id: itemId,
        tenantId,
        ownerUserId: userId,
        kind: 'card',
        // Coarse plaintext navigation hint (SPEC "metadata minimization") —
        // the barcode family, never the payload or any user-entered text.
        kindHint: barcodeFormat,
        ...itemEncryptionColumns(write),
        createdAt: ts,
        updatedAt: ts,
      });

      await db.insert(walletCardPayloads).values({
        id: randomUUID(),
        tenantId,
        itemId,
        ownerUserId: userId,
        barcodeFormat,
        payloadEncrypted: write.encrypted,
        payload: payloadColumn(write),
        frontImageKey,
        backImageKey,
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (error) {
      await discardUploads([frontImageKey ?? undefined, backImageKey ?? undefined]);
      throw error;
    }

    revalidatePath('/wallet');
    revalidatePath('/wallet/cards');
    return { ok: true as const, id: itemId };
  }, 'This card could not be saved. Please try again.');
}

export async function updateCard(cardId: string, formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { db, userId, tenantId } = await getContext();
    const barcodeFormat = barcodeFormatFrom(formData);
    const ts = now();

    const cardScope = and(
      eq(walletItems.id, cardId),
      eq(walletItems.tenantId, tenantId),
      eq(walletItems.ownerUserId, userId),
      eq(walletItems.kind, 'card'),
    );
    const payloadScope = and(
      eq(walletCardPayloads.itemId, cardId),
      eq(walletCardPayloads.tenantId, tenantId),
      eq(walletCardPayloads.ownerUserId, userId),
    );

    const existing = await db
      .select({
        frontImageKey: walletCardPayloads.frontImageKey,
        backImageKey: walletCardPayloads.backImageKey,
      })
      .from(walletCardPayloads)
      .where(payloadScope)
      .limit(1);
    const previous = existing[0];
    // Verify ownership before uploading anything — a crafted request for a
    // cardId the caller doesn't own must not upload orphaned storage objects
    // under its own account before the (rejected) DB write below.
    if (!previous) return { ok: false as const, error: 'That card no longer exists.' };

    // …and validate the rest of the submission before uploading too.
    const pending = readPendingImages(formData);
    if ('error' in pending) return { ok: false as const, error: pending.error };
    const write = resolveCardWrite(formData);
    if ('error' in write) return { ok: false as const, error: write.error };

    const uploaded = await Promise.all(
      pending.images.map(async (image) => ({
        side: image.side,
        key: await uploadCardImage(image, userId),
      })),
    );
    const newFrontImageKey = uploaded.find((u) => u.side === 'front')?.key;
    const newBackImageKey = uploaded.find((u) => u.side === 'back')?.key;
    const imagePatch = {
      ...(newFrontImageKey !== undefined && { frontImageKey: newFrontImageKey }),
      ...(newBackImageKey !== undefined && { backImageKey: newBackImageKey }),
    };

    try {
      const updatedItems = await db
        .update(walletItems)
        .set({
          kindHint: barcodeFormat,
          ...itemEncryptionColumns(write),
          updatedAt: ts,
        })
        .where(cardScope)
        .returning({ id: walletItems.id });
      if (updatedItems.length === 0) {
        await discardUploads([newFrontImageKey, newBackImageKey]);
        return { ok: false as const, error: 'That card no longer exists.' };
      }

      await db
        .update(walletCardPayloads)
        .set({
          barcodeFormat,
          payloadEncrypted: write.encrypted,
          payload: payloadColumn(write),
          ...imagePatch,
          updatedAt: ts,
        })
        .where(payloadScope);
    } catch (error) {
      await discardUploads([newFrontImageKey, newBackImageKey]);
      throw error;
    }

    // The old bytes go only once the new ones are safely referenced.
    await discardUploads([
      newFrontImageKey && previous.frontImageKey ? previous.frontImageKey : undefined,
      newBackImageKey && previous.backImageKey ? previous.backImageKey : undefined,
    ]);

    revalidatePath('/wallet');
    revalidatePath('/wallet/cards');
    revalidatePath(`/wallet/cards/${cardId}`);
    return ACTION_OK;
  }, 'This card could not be saved. Please try again.');
}

export async function deleteCard(cardId: string): Promise<ActionResult> {
  return guarded(async () => {
    const { db, userId, tenantId } = await getContext();

    const payloadScope = and(
      eq(walletCardPayloads.itemId, cardId),
      eq(walletCardPayloads.tenantId, tenantId),
      eq(walletCardPayloads.ownerUserId, userId),
    );
    const existing = await db
      .select({
        frontImageKey: walletCardPayloads.frontImageKey,
        backImageKey: walletCardPayloads.backImageKey,
      })
      .from(walletCardPayloads)
      .where(payloadScope)
      .limit(1);
    const previous = existing[0];
    await discardUploads([previous?.frontImageKey ?? undefined, previous?.backImageKey ?? undefined]);

    await db.delete(walletCardPayloads).where(payloadScope);

    await db
      .delete(walletItems)
      .where(
        and(
          eq(walletItems.id, cardId),
          eq(walletItems.tenantId, tenantId),
          eq(walletItems.ownerUserId, userId),
          eq(walletItems.kind, 'card'),
        ),
      );

    revalidatePath('/wallet');
    revalidatePath('/wallet/cards');
    return ACTION_OK;
  }, 'This card could not be deleted. Please try again.');
}
