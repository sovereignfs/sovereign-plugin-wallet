import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Wallet Postgres schema mirror.
 *
 * Application code should import `db/schema.ts` (→ `app/_db/schema.ts`).
 * This file mirrors the same physical column names and broadly compatible
 * scalar types for Postgres migration generation only — it is never imported
 * by application code. No native `boolean`/`bigint` here: application code
 * stays on the SQLite-typed schema, so Postgres columns must serialize
 * identically to it (see docs/plugin-database.md).
 */

export const walletItems = pgTable(
  'wallet_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    kind: text('kind').notNull(),
    kindHint: text('kind_hint'),
    storageObjectKey: text('storage_object_key'),
    encryptionVersion: text('encryption_version'),
    encryptedMetadata: text('encrypted_metadata'),
    wrappedDek: text('wrapped_dek'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('wallet_items_tenant_owner_idx').on(t.tenantId, t.ownerUserId)],
);

export const walletCardPayloads = pgTable(
  'wallet_card_payloads',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => walletItems.id),
    ownerUserId: text('owner_user_id').notNull(),
    barcodeFormat: text('barcode_format'),
    payloadEncrypted: integer('payload_encrypted').notNull().default(0),
    payload: text('payload').notNull(),
    frontImageKey: text('front_image_key'),
    backImageKey: text('back_image_key'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('wallet_card_payloads_item_idx').on(t.itemId)],
);
