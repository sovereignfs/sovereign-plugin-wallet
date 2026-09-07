import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionContext,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition =
  | { kind: 'eq'; key: string; value: unknown }
  | { kind: 'and'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

// Real and()/eq() build opaque SQL AST nodes; mocking them to build a small,
// interpretable Condition tree instead lets the fake db below actually
// filter rows per-query (same pattern as sovereign-plainwrite's own test).
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') return row[condition.key] === condition.value;
  return condition.conditions.every((c) => matches(row, c));
}

const capturedExporter = {
  fn: null as ((ctx: ExportContext) => Promise<PluginExportSection>) | null,
};
const capturedImporter = {
  fn: null as ((section: PluginExportSection, ctx: ImportContext) => Promise<void>) | null,
};
const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<{ deleted: number; errors?: string[] }>) | null,
};

interface FakeStorageObject {
  id: string;
  contentType: string;
  metadata: Record<string, unknown> | null;
  bytes: Uint8Array;
}

const storageStore = new Map<string, FakeStorageObject>();
const storagePut = vi.fn(
  async (input: { key: string; body: Uint8Array; contentType: string; metadata?: unknown }) => {
    storageStore.set(input.key, {
      id: input.key,
      contentType: input.contentType,
      metadata: (input.metadata as Record<string, unknown> | null | undefined) ?? null,
      bytes: input.body,
    });
  },
);
const storageGet = vi.fn(async (key: string) => {
  const object = storageStore.get(key);
  if (!object) return null;
  return {
    id: object.id,
    contentType: object.contentType,
    metadata: object.metadata,
    body: new Blob([object.bytes as BlobPart]).stream(),
  };
});
const storageDelete = vi.fn(async (key: string) => {
  storageStore.delete(key);
});

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    storage: { put: storagePut, get: storageGet, delete: storageDelete },
    portability: {
      provideExport: vi.fn(async (fn: typeof capturedExporter.fn) => {
        capturedExporter.fn = fn;
      }),
      provideImport: vi.fn(async (fn: typeof capturedImporter.fn) => {
        capturedImporter.fn = fn;
      }),
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  wallet_items: Row[];
  wallet_card_payloads: Row[];
}

let store: Store = { wallet_items: [], wallet_card_payloads: [] };

function resetStore() {
  store = { wallet_items: [], wallet_card_payloads: [] };
  storageStore.clear();
}

function project(rows: Row[], columns?: Record<string, unknown>): Row[] {
  if (!columns) return rows;
  return rows.map((row) => {
    const projected: Row = {};
    for (const key of Object.keys(columns)) projected[key] = row[key];
    return projected;
  });
}

function whereChain(rows: Row[], columns: Record<string, unknown> | undefined) {
  return {
    where: (condition?: Condition) => {
      const filtered = rows.filter((row) => matches(row, condition));
      const projected = project(filtered, columns);
      return Object.assign(Promise.resolve(projected), {
        limit: (_n: number) => Promise.resolve(projected),
      });
    },
  };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        const rows = store[tableName] ?? [];
        return {
          ...whereChain(rows, columns),
          // wallet_items/wallet_card_payloads join 1:1 on itemId — a real
          // ON condition isn't interpreted here, this test harness only
          // needs to merge the matching payload row onto its item row.
          innerJoin: (joinTable: Table, _on: unknown) => {
            const joinName = getTableName(joinTable);
            const joined = rows.map((row) => {
              const match = (store[joinName] ?? []).find((r) => r.itemId === row.id);
              // The base table's columns win on name collisions (id, tenantId,
              // createdAt, updatedAt) — matches what the real query's explicit
              // column selection (`walletItems.id` etc.) actually returns.
              return { ...match, ...row };
            });
            return whereChain(joined, columns);
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Row) => {
        (store[tableName] ??= []).push(row);
      },
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability export', () => {
  it('exports an unencrypted card with its front image bytes', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.wallet_items = [
      {
        id: 'card-1',
        tenantId: 't1',
        ownerUserId: 'user-1',
        kind: 'card',
        kindHint: null,
        storageObjectKey: null,
        encryptionVersion: null,
        encryptedMetadata: JSON.stringify({ title: 'Costco', issuer: 'Costco', notes: '' }),
        wrappedDek: null,
        createdAt: 10,
        updatedAt: 10,
      },
    ];
    storageStore.set('cards/front-1', {
      id: 'cards/front-1',
      contentType: 'image/png',
      metadata: null,
      bytes: new Uint8Array([1, 2, 3]),
    });
    store.wallet_card_payloads = [
      {
        id: 'payload-1',
        tenantId: 't1',
        itemId: 'card-1',
        ownerUserId: 'user-1',
        barcodeFormat: 'qr',
        payloadEncrypted: false,
        payload: '1234',
        frontImageKey: 'cards/front-1',
        backImageKey: null,
        createdAt: 10,
        updatedAt: 10,
      },
    ];

    const section = await capturedExporter.fn?.({
      userId: 'user-1',
      tenantId: 't1',
      options: { includeFiles: true },
    });

    expect(section?.pluginId).toBe('fs.sovereign.wallet');
    const data = section?.data as { cards: unknown[]; documents: unknown[] };
    expect(data.cards).toHaveLength(1);
    expect(data.documents).toHaveLength(0);
    const card = data.cards[0] as {
      id: string;
      encrypted: boolean;
      frontImageBlobPath: string | null;
      frontImageMeta: { contentType: string; iv: string | null } | null;
    };
    expect(card.id).toBe('card-1');
    expect(card.encrypted).toBe(false);
    expect(card.frontImageBlobPath).toBe('cards/card-1/front');
    expect(card.frontImageMeta).toEqual({
      contentType: 'image/png',
      iv: null,
      blobAlgorithmVersion: null,
    });
    expect(section?.blobs?.['cards/card-1/front']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('exports an encrypted document with its ciphertext and cipher metadata', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.wallet_items = [
      {
        id: 'doc-1',
        tenantId: 't1',
        ownerUserId: 'user-1',
        kind: 'document',
        kindHint: null,
        storageObjectKey: 'documents/doc-1-obj',
        encryptionVersion: 'v1',
        encryptedMetadata: JSON.stringify({ ciphertext: 'abc', iv: 'iv1', algorithmVersion: 'v1' }),
        wrappedDek: JSON.stringify({ wrappedDek: 'wrapped', algorithmVersion: 'v1' }),
        createdAt: 20,
        updatedAt: 20,
      },
    ];
    storageStore.set('documents/doc-1-obj', {
      id: 'documents/doc-1-obj',
      contentType: 'application/octet-stream',
      metadata: { iv: 'blob-iv', blobAlgorithmVersion: 'v1', contentType: 'image/jpeg' },
      bytes: new Uint8Array([9, 8, 7]),
    });

    const section = await capturedExporter.fn?.({
      userId: 'user-1',
      tenantId: 't1',
      options: { includeFiles: true },
    });
    const data = section?.data as {
      documents: { id: string; blobPath: string; blobMeta: unknown }[];
    };
    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]?.blobPath).toBe('documents/doc-1');
    expect(section?.blobs?.['documents/doc-1']).toEqual(new Uint8Array([9, 8, 7]));
    expect(data.documents[0]?.blobMeta).toEqual({
      contentType: 'image/jpeg',
      iv: 'blob-iv',
      blobAlgorithmVersion: 'v1',
    });
  });
});

describe('portability import', () => {
  it('restores a card, remapping its id and re-uploading its image under a fresh key', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.wallet',
      schemaVersion: 1,
      data: {
        cards: [
          {
            id: 'src-card-1',
            encrypted: false,
            encryptedMetadata: JSON.stringify({ title: 'Costco', issuer: '', notes: '' }),
            encryptionVersion: null,
            wrappedDek: null,
            barcodeFormat: 'qr',
            payloadEncrypted: false,
            payload: '1234',
            frontImageBlobPath: 'cards/src-card-1/front',
            backImageBlobPath: null,
            frontImageMeta: { contentType: 'image/png', iv: null, blobAlgorithmVersion: null },
            backImageMeta: null,
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        documents: [],
      },
      blobs: { 'cards/src-card-1/front': new Uint8Array([1, 2, 3]) },
    };

    let remapCalls = 0;
    const ctx: ImportContext = {
      userId: 'user-2',
      tenantId: 't1',
      remapId: (id: string) => {
        remapCalls++;
        return `new-${id}`;
      },
    };
    await capturedImporter.fn?.(section, ctx);

    expect(remapCalls).toBe(1);
    expect(store.wallet_items).toHaveLength(1);
    expect(store.wallet_items[0]).toMatchObject({
      id: 'new-src-card-1',
      ownerUserId: 'user-2',
      kind: 'card',
    });
    expect(store.wallet_card_payloads).toHaveLength(1);
    const payload = store.wallet_card_payloads[0] as { frontImageKey: string };
    expect(payload.frontImageKey).toMatch(/^cards\//);
    expect(payload.frontImageKey).not.toBe('cards/src-card-1/front');
    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png', ownerUserId: 'user-2' }),
    );
  });

  it('skips a document whose ciphertext bytes are missing from the bundle', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.wallet',
      schemaVersion: 1,
      data: {
        cards: [],
        documents: [
          {
            id: 'doc-1',
            encryptedMetadata: '{}',
            encryptionVersion: 'v1',
            wrappedDek: '{}',
            blobPath: 'documents/doc-1',
            blobMeta: { contentType: 'image/jpeg', iv: 'iv1', blobAlgorithmVersion: 'v1' },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      blobs: {}, // missing bytes
    };

    await capturedImporter.fn?.(section, { userId: 'user-2', tenantId: 't1', remapId: (id) => id });

    expect(store.wallet_items).toHaveLength(0);
  });
});

describe('portability delete', () => {
  it("deletes all of a user's card and document rows plus their storage objects", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    storageStore.set('cards/front-1', {
      id: 'cards/front-1',
      contentType: 'image/png',
      metadata: null,
      bytes: new Uint8Array(),
    });
    storageStore.set('documents/doc-1-obj', {
      id: 'documents/doc-1-obj',
      contentType: 'application/octet-stream',
      metadata: null,
      bytes: new Uint8Array(),
    });
    store.wallet_items = [
      { id: 'card-1', tenantId: 't1', ownerUserId: 'user-1', kind: 'card', storageObjectKey: null },
      {
        id: 'doc-1',
        tenantId: 't1',
        ownerUserId: 'user-1',
        kind: 'document',
        storageObjectKey: 'documents/doc-1-obj',
      },
    ];
    store.wallet_card_payloads = [
      {
        id: 'payload-1',
        tenantId: 't1',
        itemId: 'card-1',
        ownerUserId: 'user-1',
        frontImageKey: 'cards/front-1',
        backImageKey: null,
      },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(store.wallet_items).toHaveLength(0);
    expect(store.wallet_card_payloads).toHaveLength(0);
    expect(storageDelete).toHaveBeenCalledWith('cards/front-1');
    expect(storageDelete).toHaveBeenCalledWith('documents/doc-1-obj');
    expect(result?.deleted).toBeGreaterThan(0);
    expect(result?.errors).toBeUndefined();
  });
});

describe('portability import — validating an untrusted bundle', () => {
  /** A bundle whose card list is structurally wrong in one specific way. */
  function sectionWithCard(card: unknown): PluginExportSection {
    return {
      pluginId: 'fs.sovereign.wallet',
      schemaVersion: 1,
      data: { cards: [card], documents: [] },
      blobs: {},
    };
  }

  const ctx: ImportContext = {
    userId: 'user-2',
    tenantId: 't1',
    remapId: (id: string) => `new-${id}`,
  };

  it.each([
    ['a missing id', { payload: '1234', payloadEncrypted: false, createdAt: 1, updatedAt: 1 }],
    ['a non-string payload', { id: 'c', payload: 42, payloadEncrypted: false, createdAt: 1, updatedAt: 1 }],
    ['a missing payload', { id: 'c', payloadEncrypted: false, createdAt: 1, updatedAt: 1 }],
    ['non-numeric timestamps', { id: 'c', payload: 'x', payloadEncrypted: false, createdAt: 'y', updatedAt: 'z' }],
    ['a null entry', null],
  ])('skips a card with %s rather than inserting it', async (_label, card) => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    // A bundle is user-supplied input from another instance. Import runs
    // without a transaction, so a malformed row must be skipped, not thrown
    // on — throwing partway leaves half a wallet restored.
    await expect(capturedImporter.fn?.(sectionWithCard(card), ctx)).resolves.toBeUndefined();
    expect(store.wallet_items).toHaveLength(0);
    expect(store.wallet_card_payloads).toHaveLength(0);
  });

  it('imports the valid cards in a bundle that also contains a malformed one', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.wallet',
      schemaVersion: 1,
      data: {
        cards: [
          { id: 'bad' },
          {
            id: 'good',
            encrypted: false,
            encryptedMetadata: JSON.stringify({ title: 'Keeps', issuer: '', notes: '' }),
            encryptionVersion: null,
            wrappedDek: null,
            barcodeFormat: 'qr',
            payloadEncrypted: false,
            payload: '1234',
            frontImageBlobPath: null,
            backImageBlobPath: null,
            frontImageMeta: null,
            backImageMeta: null,
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        documents: [],
      },
      blobs: {},
    };

    await capturedImporter.fn?.(section, ctx);

    expect(store.wallet_items).toHaveLength(1);
    expect(store.wallet_items[0]).toMatchObject({ id: 'new-good' });
  });

  it('degrades a bundle-declared script content type to an opaque one', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.wallet',
      schemaVersion: 1,
      data: {
        cards: [
          {
            id: 'src',
            encrypted: false,
            encryptedMetadata: JSON.stringify({ title: 'x', issuer: '', notes: '' }),
            encryptionVersion: null,
            wrappedDek: null,
            barcodeFormat: 'qr',
            payloadEncrypted: false,
            payload: '1234',
            frontImageBlobPath: 'cards/src/front',
            backImageBlobPath: null,
            // A crafted bundle can name any content type; storing it would
            // serve attacker HTML from the runtime's own origin.
            frontImageMeta: { contentType: 'text/html', iv: null, blobAlgorithmVersion: null },
            backImageMeta: null,
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        documents: [],
      },
      blobs: { 'cards/src/front': new Uint8Array([1]) },
    };

    await capturedImporter.fn?.(section, ctx);

    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/octet-stream' }),
    );
  });
});
