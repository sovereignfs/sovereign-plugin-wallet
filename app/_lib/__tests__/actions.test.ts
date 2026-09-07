import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeDb, type Row } from './fake-db';

// Inlined rather than imported from `./fake-db`: `vi.mock` is hoisted above
// the imports, so referencing that module here (it imports `drizzle-orm`
// itself) fails with "Cannot access '__vi_import_0__' before initialization".
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

// `revalidatePath` throws outside a request scope ("static generation store
// missing"). Stubbing it keeps these unit tests about the action's own logic.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let sessionUserId = 'user-1';
let sessionTenantId = 't1';

const storagePut = vi.fn(async () => undefined);
const storageDelete = vi.fn(async () => undefined);

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
      get: vi.fn(async () => null),
      delete: (...args: unknown[]) => storageDelete(...(args as [])),
      getSignedUrl: vi.fn(async () => 'https://example.test/signed'),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  wallet_items: Row[];
  wallet_card_payloads: Row[];
}

let store: Store = { wallet_items: [], wallet_card_payloads: [] };
const fakeDb = makeFakeDb(() => store);

function seedCard(overrides: Partial<Row> = {}) {
  store.wallet_items.push({
    id: 'card-1',
    tenantId: 't1',
    ownerUserId: 'user-1',
    kind: 'card',
    kindHint: 'qr',
    storageObjectKey: null,
    encryptionVersion: null,
    encryptedMetadata: JSON.stringify({ title: 'Costco', issuer: '', notes: '' }),
    wrappedDek: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
  store.wallet_card_payloads.push({
    id: 'payload-1',
    tenantId: 't1',
    itemId: 'card-1',
    ownerUserId: 'user-1',
    barcodeFormat: 'qr',
    payloadEncrypted: false,
    payload: '1234',
    frontImageKey: null,
    backImageKey: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

/** A card already encrypted, as `createCard` would have written it. */
function seedEncryptedCard() {
  const cipher = JSON.stringify({ ciphertext: 'c', iv: 'i', algorithmVersion: 'v1' });
  seedCard({
    encryptionVersion: 'v1',
    encryptedMetadata: cipher,
    wrappedDek: JSON.stringify({ wrappedDek: 'wrapped', algorithmVersion: 'v1' }),
    payloadEncrypted: true,
    payload: cipher,
  });
}

function cardForm(fields: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('title', 'Costco');
  formData.set('payload', '1234');
  formData.set('barcodeFormat', 'qr');
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = { wallet_items: [], wallet_card_payloads: [] };
  sessionUserId = 'user-1';
  sessionTenantId = 't1';
});

describe('tenant/owner scoping — getCard', () => {
  it("returns null for another user's card in the same tenant", async () => {
    const { getCard } = await import('../actions');
    seedCard();
    sessionUserId = 'user-2'; // different owner, same tenant

    expect(await getCard('card-1')).toBeNull();
  });

  it('returns null for the same owner id in a different tenant', async () => {
    const { getCard } = await import('../actions');
    seedCard();
    sessionTenantId = 't2'; // different tenant, same nominal userId

    expect(await getCard('card-1')).toBeNull();
  });

  it('returns the card for its actual owner in its actual tenant', async () => {
    const { getCard } = await import('../actions');
    seedCard();

    const card = await getCard('card-1');
    expect(card?.id).toBe('card-1');
  });

  it('reports an encrypted card with unparseable cipher columns as encrypted-but-unopenable', async () => {
    const { getCard } = await import('../actions');
    seedCard({ encryptionVersion: 'v1', encryptedMetadata: 'not json', wrappedDek: 'not json' });

    // Must not throw: a 500 here is a detail page the owner can never open
    // again. `cipher: null` drives the "can't be opened" state instead.
    const card = await getCard('card-1');
    expect(card?.encrypted).toBe(true);
    expect(card?.cipher).toBeNull();
  });
});

describe('tenant/owner scoping — updateCard', () => {
  it("refuses and makes no changes when called for another user's card", async () => {
    const { updateCard } = await import('../actions');
    seedCard();
    const originalMetadata = store.wallet_items[0]?.encryptedMetadata;
    sessionUserId = 'user-2';

    const result = await updateCard('card-1', cardForm({ title: 'Hijacked', payload: '9999' }));

    expect(result.ok).toBe(false);
    expect(store.wallet_items[0]?.encryptedMetadata).toBe(originalMetadata);
  });
});

describe('tenant/owner scoping — deleteCard', () => {
  it("is a no-op when called for another tenant's card of the same id", async () => {
    const { deleteCard } = await import('../actions');
    seedCard();
    sessionTenantId = 't2';

    await deleteCard('card-1');

    expect(store.wallet_items).toHaveLength(1);
    expect(store.wallet_card_payloads).toHaveLength(1);
  });
});

describe('expected failures return a message instead of throwing', () => {
  it('reports a missing display name', async () => {
    const { createCard } = await import('../actions');
    const formData = cardForm();
    formData.set('title', '');

    const result = await createCard(formData);

    expect(result).toEqual({ ok: false, error: 'Display name is required.' });
    expect(store.wallet_items).toHaveLength(0);
  });

  it('reports a missing payload', async () => {
    const { createCard } = await import('../actions');
    const formData = cardForm();
    formData.set('payload', '');

    const result = await createCard(formData);

    expect(result).toEqual({ ok: false, error: 'Card payload is required.' });
  });

  it('reports an encrypted submission missing its cipher fields', async () => {
    const { createCard } = await import('../actions');
    const formData = cardForm({ encrypted: 'true' });

    const result = await createCard(formData);

    expect(result.ok).toBe(false);
    expect(store.wallet_items).toHaveLength(0);
  });

  it('returns the new id on success so the client can navigate', async () => {
    const { createCard } = await import('../actions');

    const result = await createCard(cardForm());

    expect(result.ok).toBe(true);
    expect(store.wallet_items).toHaveLength(1);
    expect(store.wallet_card_payloads).toHaveLength(1);
  });
});

describe('storage objects are never orphaned by a rejected submission', () => {
  it('uploads nothing when validation fails', async () => {
    const { createCard } = await import('../actions');
    const formData = cardForm();
    formData.set('title', ''); // fails validation
    formData.set('frontImage', new File(['bytes'], 'front.png', { type: 'image/png' }));

    const result = await createCard(formData);

    expect(result.ok).toBe(false);
    // The pre-fix ordering uploaded both images before checking the title,
    // leaving objects nothing referenced against the user's quota.
    expect(storagePut).not.toHaveBeenCalled();
  });

  it("uploads nothing when the caller doesn't own the card being updated", async () => {
    const { updateCard } = await import('../actions');
    seedCard();
    sessionUserId = 'user-2';
    const formData = cardForm();
    formData.set('frontImage', new File(['bytes'], 'front.png', { type: 'image/png' }));

    await updateCard('card-1', formData);

    expect(storagePut).not.toHaveBeenCalled();
  });
});

describe('card image content types are allowlisted before storage', () => {
  it('stores a real image type as-is', async () => {
    const { createCard } = await import('../actions');
    const formData = cardForm();
    formData.set('frontImage', new File(['bytes'], 'front.png', { type: 'image/png' }));

    await createCard(formData);

    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    );
  });

  it('degrades a non-image type to an opaque one', async () => {
    const { createCard } = await import('../actions');
    const formData = cardForm();
    // `accept="image/*"` is only a picker filter — a crafted request can
    // declare anything. Storing `text/html` would have it served back as an
    // HTML document from the runtime's own origin, outside the CSP.
    formData.set('frontImage', new File(['<script>'], 'x.html', { type: 'text/html' }));

    await createCard(formData);

    expect(storagePut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/octet-stream' }),
    );
  });
});

describe('encryption columns never survive a plaintext write', () => {
  it('clears encryption_version and wrapped_dek when a card is saved unencrypted', async () => {
    const { updateCard, getCard } = await import('../actions');
    seedEncryptedCard();
    expect(store.wallet_items[0]?.encryptionVersion).toBe('v1');

    const result = await updateCard('card-1', cardForm({ title: 'Now plaintext' }));

    expect(result.ok).toBe(true);
    // Leaving these set made `getCard` parse the plaintext payload as
    // ciphertext on the next read, permanently 500ing that card's page.
    expect(store.wallet_items[0]?.encryptionVersion).toBeNull();
    expect(store.wallet_items[0]?.wrappedDek).toBeNull();
    expect(store.wallet_card_payloads[0]?.payloadEncrypted).toBe(false);

    const card = await getCard('card-1');
    expect(card?.encrypted).toBe(false);
    expect(card?.title).toBe('Now plaintext');
  });

  it('sets them when a plaintext card is upgraded to encrypted', async () => {
    const { updateCard } = await import('../actions');
    seedCard();

    const result = await updateCard(
      'card-1',
      cardForm({
        encrypted: 'true',
        encryptedMetadata: JSON.stringify({ ciphertext: 'c', iv: 'i', algorithmVersion: 'v1' }),
        encryptedPayload: JSON.stringify({ ciphertext: 'p', iv: 'i', algorithmVersion: 'v1' }),
        wrappedDek: JSON.stringify({ wrappedDek: 'w', algorithmVersion: 'v1' }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(store.wallet_items[0]?.encryptionVersion).toBe('v1');
    expect(store.wallet_card_payloads[0]?.payloadEncrypted).toBe(true);
  });
});
