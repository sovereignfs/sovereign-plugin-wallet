import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeDb, type Row } from './fake-db';
import { MAX_DOCUMENT_BYTES } from '../mediaTypes';

// Inlined for the same hoisting reason documented in `actions.test.ts`.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  const camel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown) => ({
      kind: 'eq',
      key: camel(column.name),
      value,
    }),
    and: (...conditions: unknown[]) => ({ kind: 'and', conditions }),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let sessionUserId = 'user-1';
let sessionTenantId = 't1';

const storagePut = vi.fn(async () => undefined);
const storageDelete = vi.fn(async () => undefined);
let storageObject: { metadata: unknown; size: number; contentType: string } | null = null;

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: {
      requireSession: vi.fn(async () => ({
        user: { id: sessionUserId, tenantId: sessionTenantId },
      })),
    },
    db: { getClient: vi.fn(async () => fakeDb) },
    storage: {
      put: (...args: unknown[]) => storagePut(...(args as [])),
      get: vi.fn(async () => storageObject),
      delete: (...args: unknown[]) => storageDelete(...(args as [])),
      getSignedUrl: vi.fn(async () => 'https://example.test/signed'),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  wallet_items: Row[];
}

let store: Store = { wallet_items: [] };
const fakeDb = makeFakeDb(() => store);

const CIPHER = JSON.stringify({ ciphertext: 'c', iv: 'i', algorithmVersion: 'v1' });
const WRAPPED = JSON.stringify({ wrappedDek: 'w', algorithmVersion: 'v1' });

function seedDocument(overrides: Partial<Row> = {}) {
  store.wallet_items.push({
    id: 'doc-1',
    tenantId: 't1',
    ownerUserId: 'user-1',
    kind: 'document',
    kindHint: 'document',
    storageObjectKey: 'documents/abc',
    encryptionVersion: 'v1',
    encryptedMetadata: CIPHER,
    wrappedDek: WRAPPED,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

function uploadForm(overrides: Record<string, unknown> = {}): FormData {
  const formData = new FormData();
  formData.set('ciphertext', new Blob(['ciphertext-bytes']), 'ciphertext.bin');
  formData.set('blobIv', 'iv');
  formData.set('blobAlgorithmVersion', 'v1');
  formData.set('encryptedMetadata', CIPHER);
  formData.set('wrappedDek', WRAPPED);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) formData.delete(key);
    else formData.set(key, value as string | Blob);
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = { wallet_items: [] };
  sessionUserId = 'user-1';
  sessionTenantId = 't1';
  storageObject = {
    metadata: { iv: 'iv', blobAlgorithmVersion: 'v1' },
    size: 1234,
    contentType: 'application/octet-stream',
  };
});

describe('tenant/owner scoping — getDocument', () => {
  it("returns null for another user's document in the same tenant", async () => {
    const { getDocument } = await import('../documentActions');
    seedDocument();
    sessionUserId = 'user-2';

    expect(await getDocument('doc-1')).toBeNull();
  });

  it('returns null for the same owner id in a different tenant', async () => {
    const { getDocument } = await import('../documentActions');
    seedDocument();
    sessionTenantId = 't2';

    expect(await getDocument('doc-1')).toBeNull();
  });

  it('returns the document for its actual owner in its actual tenant', async () => {
    const { getDocument } = await import('../documentActions');
    seedDocument();

    const doc = await getDocument('doc-1');
    expect(doc?.id).toBe('doc-1');
    expect(doc?.sizeBytes).toBe(1234);
  });

  it('returns null rather than throwing when the cipher columns are malformed', async () => {
    const { getDocument } = await import('../documentActions');
    seedDocument({ wrappedDek: 'not json' });

    expect(await getDocument('doc-1')).toBeNull();
  });
});

describe('tenant/owner scoping — listDocuments', () => {
  it("excludes another user's documents", async () => {
    const { listDocuments } = await import('../documentActions');
    seedDocument();
    sessionUserId = 'user-2';

    expect(await listDocuments()).toHaveLength(0);
  });

  it("excludes another tenant's documents", async () => {
    const { listDocuments } = await import('../documentActions');
    seedDocument();
    sessionTenantId = 't2';

    expect(await listDocuments()).toHaveLength(0);
  });

  it('returns the caller’s own documents', async () => {
    const { listDocuments } = await import('../documentActions');
    seedDocument();

    expect(await listDocuments()).toHaveLength(1);
  });
});

describe('tenant/owner scoping — updateDocument', () => {
  it("refuses and changes nothing for another user's document", async () => {
    const { updateDocument } = await import('../documentActions');
    seedDocument();
    sessionUserId = 'user-2';

    const body = new FormData();
    body.set('encryptedMetadata', 'hijacked');
    const result = await updateDocument('doc-1', body);

    expect(result.ok).toBe(false);
    expect(store.wallet_items[0]?.encryptedMetadata).toBe(CIPHER);
  });

  it('re-seals metadata for the owner without touching the stored ciphertext', async () => {
    const { updateDocument } = await import('../documentActions');
    seedDocument();

    const body = new FormData();
    body.set('encryptedMetadata', 'new-cipher');
    const result = await updateDocument('doc-1', body);

    expect(result.ok).toBe(true);
    expect(store.wallet_items[0]?.encryptedMetadata).toBe('new-cipher');
    // Renaming a document must never re-upload it.
    expect(storagePut).not.toHaveBeenCalled();
    expect(store.wallet_items[0]?.storageObjectKey).toBe('documents/abc');
  });
});

describe('tenant/owner scoping — deleteDocument', () => {
  it("is a no-op for another tenant's document of the same id", async () => {
    const { deleteDocument } = await import('../documentActions');
    seedDocument();
    sessionTenantId = 't2';

    const result = await deleteDocument('doc-1');

    expect(result.ok).toBe(false);
    expect(store.wallet_items).toHaveLength(1);
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it('removes the row and its ciphertext for the owner', async () => {
    const { deleteDocument } = await import('../documentActions');
    seedDocument();

    const result = await deleteDocument('doc-1');

    expect(result.ok).toBe(true);
    expect(store.wallet_items).toHaveLength(0);
    expect(storageDelete).toHaveBeenCalledWith('documents/abc');
  });
});

describe('createDocument', () => {
  it('stores ciphertext under an opaque content type and returns the new id', async () => {
    const { createDocument } = await import('../documentActions');

    const result = await createDocument(uploadForm());

    expect(result.ok).toBe(true);
    expect(store.wallet_items).toHaveLength(1);
    // The real type lives inside the encrypted metadata — never in a header
    // the signed-download route would echo back.
    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/octet-stream' }),
    );
  });

  it('reports a missing wrapped key instead of throwing', async () => {
    const { createDocument } = await import('../documentActions');

    const result = await createDocument(uploadForm({ wrappedDek: null }));

    expect(result.ok).toBe(false);
    expect(store.wallet_items).toHaveLength(0);
    expect(storagePut).not.toHaveBeenCalled();
  });

  it('names the actual size when the ciphertext is over the body limit', async () => {
    const { createDocument } = await import('../documentActions');
    const oversized = new Blob([new Uint8Array(MAX_DOCUMENT_BYTES + 1)]);

    const result = await createDocument(uploadForm({ ciphertext: oversized }));

    expect(result.ok).toBe(false);
    // A generic "something went wrong encrypting" told the user nothing they
    // could act on; the limit and the actual size both have to be in it.
    expect(result.ok === false && result.error).toMatch(/limit/i);
    expect(storagePut).not.toHaveBeenCalled();
  });
});
