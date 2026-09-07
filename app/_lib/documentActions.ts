'use server';

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import { walletItems } from '../_db/schema';
import type { EncryptedField, WrappedDekField } from './actions';
import { formString, now, parseJsonOrNull } from './formUtils';
import { ACTION_OK, guarded } from './actionResult';
import type { ActionResult, CreateResult } from './actionResult';
import { MAX_DOCUMENT_BYTES, OPAQUE_CONTENT_TYPE, tooLargeMessage } from './mediaTypes';

/** See the same note in `actions.ts` — this cast is correct on both dialects. */
type Db = BaseSQLiteDatabase<'async', unknown>;

/**
 * Sensitive documents (SPEC: "client-side encrypted object required" — unlike
 * loyalty cards, there is no plaintext path here at all; W-11's opt-in model
 * doesn't apply). The binary ciphertext lives in `sdk.storage`
 * (`documents/<id>`); `wallet_items` holds only the wrapped DEK and encrypted
 * metadata, mirroring the encrypted-card shape from `actions.ts`.
 */
export interface DocumentListItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Opaque ciphertext so the list view can decrypt the title client-side (RFC 0060) — the server never decrypts. */
  cipher: {
    encryptedMetadata: EncryptedField;
    wrappedDek: WrappedDekField;
  };
}

export interface DocumentDetail {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Ciphertext byte length, for showing a size without decrypting. */
  sizeBytes: number;
  wrappedDek: WrappedDekField;
  encryptedMetadata: EncryptedField;
  /** IV + algorithm version for the storage object's ciphertext (`sdk.storage` metadata). */
  blobIv: string;
  blobAlgorithmVersion: string;
  /** Short-lived signed download URL for the ciphertext bytes. */
  downloadUrl: string;
}

async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

export async function listDocuments(): Promise<DocumentListItem[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({
      id: walletItems.id,
      encryptedMetadata: walletItems.encryptedMetadata,
      wrappedDek: walletItems.wrappedDek,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt,
    })
    .from(walletItems)
    .where(
      and(
        eq(walletItems.tenantId, tenantId),
        eq(walletItems.ownerUserId, userId),
        eq(walletItems.kind, 'document'),
      ),
    )
    .orderBy(desc(walletItems.updatedAt));

  const items: DocumentListItem[] = [];
  for (const row of rows) {
    const encryptedMetadata = parseJsonOrNull<EncryptedField>(row.encryptedMetadata);
    const wrappedDek = parseJsonOrNull<WrappedDekField>(row.wrappedDek);
    if (!encryptedMetadata || !wrappedDek) continue;
    items.push({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      cipher: { encryptedMetadata, wrappedDek },
    });
  }
  return items;
}

export async function getDocument(id: string): Promise<DocumentDetail | null> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({
      id: walletItems.id,
      encryptedMetadata: walletItems.encryptedMetadata,
      wrappedDek: walletItems.wrappedDek,
      storageObjectKey: walletItems.storageObjectKey,
      createdAt: walletItems.createdAt,
      updatedAt: walletItems.updatedAt,
    })
    .from(walletItems)
    .where(
      and(
        eq(walletItems.id, id),
        eq(walletItems.tenantId, tenantId),
        eq(walletItems.ownerUserId, userId),
        eq(walletItems.kind, 'document'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row?.storageObjectKey) return null;
  const encryptedMetadata = parseJsonOrNull<EncryptedField>(row.encryptedMetadata);
  const wrappedDek = parseJsonOrNull<WrappedDekField>(row.wrappedDek);
  if (!encryptedMetadata || !wrappedDek) return null;

  const object = await sdk.storage.get(row.storageObjectKey);
  if (!object) return null;
  const blobMeta = object.metadata as { iv?: string; blobAlgorithmVersion?: string } | null;
  if (!blobMeta?.iv || !blobMeta.blobAlgorithmVersion) return null;

  const downloadUrl = await sdk.storage.getSignedUrl(row.storageObjectKey, {
    expiresInSeconds: 300,
  });

  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sizeBytes: object.size,
    wrappedDek,
    encryptedMetadata,
    blobIv: blobMeta.iv,
    blobAlgorithmVersion: blobMeta.blobAlgorithmVersion,
    downloadUrl,
  };
}

export async function createDocument(formData: FormData): Promise<CreateResult> {
  return guarded(async () => {
    const { db, userId, tenantId } = await getContext();

    const ciphertext = formData.get('ciphertext');
    const iv = formString(formData, 'blobIv');
    const blobAlgorithmVersion = formString(formData, 'blobAlgorithmVersion');
    const encryptedMetadata = formString(formData, 'encryptedMetadata');
    const wrappedDek = parseJsonOrNull<WrappedDekField>(formString(formData, 'wrappedDek'));
    if (
      !(ciphertext instanceof Blob) ||
      ciphertext.size === 0 ||
      !iv ||
      !blobAlgorithmVersion ||
      !encryptedMetadata ||
      !wrappedDek?.algorithmVersion
    ) {
      return { ok: false as const, error: 'This document could not be encrypted. Please try again.' };
    }
    if (ciphertext.size > MAX_DOCUMENT_BYTES) {
      return { ok: false as const, error: tooLargeMessage(ciphertext.size, MAX_DOCUMENT_BYTES) };
    }

    const key = `documents/${randomUUID()}`;
    await sdk.storage.put({
      key,
      body: ciphertext,
      // Never the real content type — that's inside the encrypted metadata.
      contentType: OPAQUE_CONTENT_TYPE,
      ownerUserId: userId,
      metadata: { iv, blobAlgorithmVersion },
    });

    const itemId = randomUUID();
    const ts = now();
    try {
      await db.insert(walletItems).values({
        id: itemId,
        tenantId,
        ownerUserId: userId,
        kind: 'document',
        // Coarse plaintext hint only — never the document type, which stays
        // inside the encrypted metadata (SPEC metadata minimization).
        kindHint: 'document',
        storageObjectKey: key,
        encryptionVersion: wrappedDek.algorithmVersion,
        encryptedMetadata,
        wrappedDek: JSON.stringify(wrappedDek),
        createdAt: ts,
        updatedAt: ts,
      });
    } catch (error) {
      // Don't leave the ciphertext behind if the row never landed.
      await sdk.storage.delete(key).catch(() => undefined);
      throw error;
    }

    revalidatePath('/wallet');
    revalidatePath('/wallet/documents');
    return { ok: true as const, id: itemId };
  }, 'This document could not be saved. Please try again.');
}

/**
 * Re-encrypted metadata for an existing document. The ciphertext blob and its
 * wrapped DEK are untouched — only the metadata is re-sealed (client-side,
 * under the same DEK), so renaming a document never re-uploads it.
 */
export async function updateDocument(id: string, formData: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { db, userId, tenantId } = await getContext();

    const encryptedMetadata = formString(formData, 'encryptedMetadata');
    if (!encryptedMetadata) {
      return { ok: false as const, error: 'These details could not be encrypted. Please try again.' };
    }

    const updated = await db
      .update(walletItems)
      .set({ encryptedMetadata, updatedAt: now() })
      .where(
        and(
          eq(walletItems.id, id),
          eq(walletItems.tenantId, tenantId),
          eq(walletItems.ownerUserId, userId),
          eq(walletItems.kind, 'document'),
        ),
      )
      .returning({ id: walletItems.id });
    if (updated.length === 0) {
      return { ok: false as const, error: 'That document no longer exists.' };
    }

    revalidatePath('/wallet/documents');
    revalidatePath(`/wallet/documents/${id}`);
    return ACTION_OK;
  }, 'These details could not be saved. Please try again.');
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  return guarded(async () => {
    const { db, userId, tenantId } = await getContext();

    const scope = and(
      eq(walletItems.id, id),
      eq(walletItems.tenantId, tenantId),
      eq(walletItems.ownerUserId, userId),
      eq(walletItems.kind, 'document'),
    );
    const rows = await db
      .select({ storageObjectKey: walletItems.storageObjectKey })
      .from(walletItems)
      .where(scope)
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false as const, error: 'That document no longer exists.' };

    if (row.storageObjectKey) {
      await sdk.storage.delete(row.storageObjectKey).catch(() => undefined);
    }
    await db.delete(walletItems).where(scope);

    revalidatePath('/wallet');
    revalidatePath('/wallet/documents');
    return ACTION_OK;
  }, 'This document could not be deleted. Please try again.');
}
