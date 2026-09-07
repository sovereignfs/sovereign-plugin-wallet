import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import { walletCardPayloads, walletItems } from '../_db/schema';
import { OPAQUE_CONTENT_TYPE, safeImageContentType } from './mediaTypes';

/** See the same note in `actions.ts` — this cast is correct on both dialects. */
type Db = BaseSQLiteDatabase<'async', unknown>;

const PLUGIN_ID = 'fs.sovereign.wallet';
const EXPORT_SCHEMA_VERSION = 1;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Registers Wallet's export/import/delete participation (RFC 0007/0052).
 * Must be called from a request-scoped Wallet route — this repo calls it
 * from `app/layout.tsx`. Registration is in-process and resets on restart.
 *
 * All card/document rows are exported as opaque data (ciphertext + wrapped
 * DEK when encrypted, plaintext when not — RFC 0060's own rule: export
 * preserves whatever the row already is, never decrypts). Storage-object
 * bytes (card images, document ciphertext) travel as the section's `blobs`,
 * keyed by item id, and are re-uploaded under fresh `sdk.storage` keys on
 * import — a storage key from another instance/tenant isn't reusable.
 */
export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportWalletData);
  await sdk.portability.provideImport(importWalletData);
  await sdk.portability.provideDelete(deleteWalletData);
}

// ---- Export shape ----

/**
 * A storage object's real content type (always present) plus its cipher
 * metadata (present only when the object is ciphertext — encrypted cards'
 * images, and documents, which are always encrypted). Unifies the two places
 * the content type can live: `sdk.storage`'s own `contentType` field for a
 * plaintext object, or inside its `metadata` for an encrypted one (whose
 * top-level `contentType` is always the opaque `application/octet-stream`).
 */
interface ExportImageMeta {
  contentType: string;
  iv: string | null;
  blobAlgorithmVersion: string | null;
}

interface ExportCardItem {
  id: string;
  encrypted: boolean;
  encryptedMetadata: string | null;
  encryptionVersion: string | null;
  wrappedDek: string | null;
  barcodeFormat: string | null;
  payloadEncrypted: boolean;
  payload: string;
  /** Blob paths (within this section) — present only when that image exists. */
  frontImageBlobPath: string | null;
  backImageBlobPath: string | null;
  frontImageMeta: ExportImageMeta | null;
  backImageMeta: ExportImageMeta | null;
  createdAt: number;
  updatedAt: number;
}

interface ExportDocumentItem {
  id: string;
  encryptedMetadata: string;
  encryptionVersion: string;
  wrappedDek: string;
  blobPath: string;
  blobMeta: ExportImageMeta;
  createdAt: number;
  updatedAt: number;
}

interface WalletExportData {
  cards: ExportCardItem[];
  documents: ExportDocumentItem[];
}

async function readImageMeta(key: string): Promise<ExportImageMeta | null> {
  const object = await sdk.storage.get(key);
  if (!object) return null;
  const meta = object.metadata as { iv?: string; blobAlgorithmVersion?: string; contentType?: string } | null;
  if (meta?.iv && meta.blobAlgorithmVersion) {
    return {
      contentType: meta.contentType ?? 'application/octet-stream',
      iv: meta.iv,
      blobAlgorithmVersion: meta.blobAlgorithmVersion,
    };
  }
  return { contentType: object.contentType, iv: null, blobAlgorithmVersion: null };
}

/** Reads a storage object's raw bytes for inclusion in the export's `blobs`. */
async function readStorageBytes(key: string): Promise<Uint8Array | null> {
  const object = await sdk.storage.get(key);
  if (!object) return null;
  return new Uint8Array(await new Response(object.body).arrayBuffer());
}

async function exportWalletData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const blobs: Record<string, Uint8Array> = {};

  const cardRows = await db
    .select({
      id: walletItems.id,
      encryptedMetadata: walletItems.encryptedMetadata,
      encryptionVersion: walletItems.encryptionVersion,
      wrappedDek: walletItems.wrappedDek,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt,
      barcodeFormat: walletCardPayloads.barcodeFormat,
      payloadEncrypted: walletCardPayloads.payloadEncrypted,
      payload: walletCardPayloads.payload,
      frontImageKey: walletCardPayloads.frontImageKey,
      backImageKey: walletCardPayloads.backImageKey,
    })
    .from(walletItems)
    .innerJoin(walletCardPayloads, eq(walletCardPayloads.itemId, walletItems.id))
    .where(
      and(
        eq(walletItems.tenantId, ctx.tenantId),
        eq(walletItems.ownerUserId, ctx.userId),
        eq(walletItems.kind, 'card'),
      ),
    );

  const cards: ExportCardItem[] = [];
  for (const row of cardRows) {
    const encrypted = row.encryptionVersion !== null;
    let frontImageBlobPath: string | null = null;
    let backImageBlobPath: string | null = null;
    let frontImageMeta: ExportImageMeta | null = null;
    let backImageMeta: ExportImageMeta | null = null;

    if (row.frontImageKey) {
      const [bytes, meta] = await Promise.all([
        readStorageBytes(row.frontImageKey),
        readImageMeta(row.frontImageKey),
      ]);
      if (bytes) {
        frontImageBlobPath = `cards/${row.id}/front`;
        blobs[frontImageBlobPath] = bytes;
        frontImageMeta = meta;
      }
    }
    if (row.backImageKey) {
      const [bytes, meta] = await Promise.all([
        readStorageBytes(row.backImageKey),
        readImageMeta(row.backImageKey),
      ]);
      if (bytes) {
        backImageBlobPath = `cards/${row.id}/back`;
        blobs[backImageBlobPath] = bytes;
        backImageMeta = meta;
      }
    }

    cards.push({
      id: row.id,
      encrypted,
      encryptedMetadata: row.encryptedMetadata,
      encryptionVersion: row.encryptionVersion,
      wrappedDek: row.wrappedDek,
      barcodeFormat: row.barcodeFormat,
      payloadEncrypted: row.payloadEncrypted,
      payload: row.payload,
      frontImageBlobPath,
      backImageBlobPath,
      frontImageMeta,
      backImageMeta,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  const documentRows = await db
    .select({
      id: walletItems.id,
      encryptedMetadata: walletItems.encryptedMetadata,
      encryptionVersion: walletItems.encryptionVersion,
      wrappedDek: walletItems.wrappedDek,
      storageObjectKey: walletItems.storageObjectKey,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt,
    })
    .from(walletItems)
    .where(
      and(
        eq(walletItems.tenantId, ctx.tenantId),
        eq(walletItems.ownerUserId, ctx.userId),
        eq(walletItems.kind, 'document'),
      ),
    );

  const documents: ExportDocumentItem[] = [];
  for (const row of documentRows) {
    if (!row.storageObjectKey || !row.encryptedMetadata || !row.encryptionVersion || !row.wrappedDek) continue;
    const [bytes, meta] = await Promise.all([
      readStorageBytes(row.storageObjectKey),
      readImageMeta(row.storageObjectKey),
    ]);
    if (!bytes || !meta || !meta.iv || !meta.blobAlgorithmVersion) continue;
    const blobPath = `documents/${row.id}`;
    blobs[blobPath] = bytes;
    documents.push({
      id: row.id,
      encryptedMetadata: row.encryptedMetadata,
      encryptionVersion: row.encryptionVersion,
      wrappedDek: row.wrappedDek,
      blobPath,
      blobMeta: meta,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  const data: WalletExportData = { cards, documents };
  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data, blobs };
}

// ---- Import ----

function isWalletExportData(value: unknown): value is WalletExportData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WalletExportData>;
  return Array.isArray(candidate.cards) && Array.isArray(candidate.documents);
}

/**
 * Per-item validation for an imported bundle.
 *
 * A bundle is user-supplied input from another instance, so every row that
 * reaches an `insert()` is checked first. An item that fails is **skipped**,
 * not thrown on: import runs without a transaction, so throwing partway
 * through would leave the user with half their wallet restored and no way to
 * retry cleanly. Skipping keeps the rest of the restore intact.
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isValidExportCard(value: unknown): value is ExportCardItem {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<ExportCardItem>;
  return (
    isString(card.id) &&
    isString(card.payload) &&
    typeof card.payloadEncrypted === 'boolean' &&
    isNullableString(card.encryptedMetadata) &&
    isNullableString(card.encryptionVersion) &&
    isNullableString(card.wrappedDek) &&
    isNullableString(card.barcodeFormat) &&
    isNullableString(card.frontImageBlobPath) &&
    isNullableString(card.backImageBlobPath) &&
    isTimestamp(card.createdAt) &&
    isTimestamp(card.updatedAt)
  );
}

function isValidExportDocument(value: unknown): value is ExportDocumentItem {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ExportDocumentItem>;
  return (
    isString(doc.id) &&
    isString(doc.encryptedMetadata) &&
    isString(doc.encryptionVersion) &&
    isString(doc.wrappedDek) &&
    isString(doc.blobPath) &&
    isTimestamp(doc.createdAt) &&
    isTimestamp(doc.updatedAt)
  );
}

async function importWalletData(section: PluginExportSection, ctx: ImportContext): Promise<void> {
  if (!isWalletExportData(section.data)) {
    throw new Error('Wallet import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;
  const ts = now();
  const blobs = section.blobs ?? {};

  /** Re-uploads a blob (if present) under a fresh key, preserving its cipher metadata if any. */
  async function reuploadBlob(
    path: string | null,
    keyPrefix: string,
    meta: ExportImageMeta | null,
  ): Promise<string | null> {
    if (!path) return null;
    const bytes = blobs[path];
    if (!bytes) return null;
    const key = `${keyPrefix}/${randomUUID()}`;
    const encrypted = Boolean(meta?.iv && meta.blobAlgorithmVersion);
    // A bundle is user-supplied input from another instance, so its declared
    // content type goes through the same allowlist as a fresh upload — the
    // signed-download route echoes whatever is stored here straight into a
    // `Content-Type` header, outside the proxy's CSP (see `mediaTypes.ts`).
    const contentType = safeImageContentType(meta?.contentType);
    await sdk.storage.put({
      key,
      body: bytes,
      contentType: encrypted ? OPAQUE_CONTENT_TYPE : contentType,
      ownerUserId: ctx.userId,
      metadata: encrypted
        ? { iv: meta?.iv, blobAlgorithmVersion: meta?.blobAlgorithmVersion, contentType }
        : null,
    });
    return key;
  }

  for (const card of data.cards) {
    if (!isValidExportCard(card)) continue;
    const newItemId = ctx.remapId(card.id);
    const [frontImageKey, backImageKey] = await Promise.all([
      reuploadBlob(card.frontImageBlobPath, 'cards', card.frontImageMeta),
      reuploadBlob(card.backImageBlobPath, 'cards', card.backImageMeta),
    ]);

    await db.insert(walletItems).values({
      id: newItemId,
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      kind: 'card',
      kindHint: card.barcodeFormat,
      encryptedMetadata: card.encryptedMetadata,
      encryptionVersion: card.encryptionVersion,
      wrappedDek: card.wrappedDek,
      createdAt: card.createdAt,
      updatedAt: ts,
    });
    await db.insert(walletCardPayloads).values({
      id: randomUUID(),
      tenantId: ctx.tenantId,
      itemId: newItemId,
      ownerUserId: ctx.userId,
      barcodeFormat: card.barcodeFormat,
      payloadEncrypted: card.payloadEncrypted,
      payload: card.payload,
      frontImageKey,
      backImageKey,
      createdAt: card.createdAt,
      updatedAt: ts,
    });
  }

  for (const doc of data.documents) {
    if (!isValidExportDocument(doc)) continue;
    const newItemId = ctx.remapId(doc.id);
    const storageObjectKey = await reuploadBlob(doc.blobPath, 'documents', doc.blobMeta);
    if (!storageObjectKey) continue; // bundle is missing the ciphertext bytes — skip rather than create a dangling row

    await db.insert(walletItems).values({
      id: newItemId,
      tenantId: ctx.tenantId,
      ownerUserId: ctx.userId,
      kind: 'document',
      kindHint: 'document',
      storageObjectKey,
      encryptedMetadata: doc.encryptedMetadata,
      encryptionVersion: doc.encryptionVersion,
      wrappedDek: doc.wrappedDek,
      createdAt: doc.createdAt,
      updatedAt: ts,
    });
  }
}

// ---- Delete ----

async function deleteWalletData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  const errors: string[] = [];
  let deleted = 0;

  const cardPayloads = await db
    .select({
      itemId: walletCardPayloads.itemId,
      frontImageKey: walletCardPayloads.frontImageKey,
      backImageKey: walletCardPayloads.backImageKey,
    })
    .from(walletCardPayloads)
    .where(and(eq(walletCardPayloads.tenantId, ctx.tenantId), eq(walletCardPayloads.ownerUserId, ctx.userId)));

  for (const payload of cardPayloads) {
    for (const key of [payload.frontImageKey, payload.backImageKey]) {
      if (!key) continue;
      try {
        await sdk.storage.delete(key);
      } catch {
        errors.push(`Could not delete a card image (item ${payload.itemId}).`);
      }
    }
  }
  await db
    .delete(walletCardPayloads)
    .where(and(eq(walletCardPayloads.tenantId, ctx.tenantId), eq(walletCardPayloads.ownerUserId, ctx.userId)));
  deleted += cardPayloads.length;

  const documentItems = await db
    .select({ id: walletItems.id, storageObjectKey: walletItems.storageObjectKey })
    .from(walletItems)
    .where(
      and(
        eq(walletItems.tenantId, ctx.tenantId),
        eq(walletItems.ownerUserId, ctx.userId),
        eq(walletItems.kind, 'document'),
      ),
    );
  for (const doc of documentItems) {
    if (!doc.storageObjectKey) continue;
    try {
      await sdk.storage.delete(doc.storageObjectKey);
    } catch {
      errors.push(`Could not delete a document's ciphertext (item ${doc.id}).`);
    }
  }

  const itemRows = await db
    .select({ id: walletItems.id })
    .from(walletItems)
    .where(and(eq(walletItems.tenantId, ctx.tenantId), eq(walletItems.ownerUserId, ctx.userId)));
  await db
    .delete(walletItems)
    .where(and(eq(walletItems.tenantId, ctx.tenantId), eq(walletItems.ownerUserId, ctx.userId)));
  deleted += itemRows.length;

  return { deleted, errors: errors.length > 0 ? errors : undefined };
}
