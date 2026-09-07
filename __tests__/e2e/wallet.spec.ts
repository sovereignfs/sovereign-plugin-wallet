import { test, expect } from './fixtures';

/**
 * Wallet golden paths, driven through the real UI.
 *
 * Scoped to the **plaintext card** flows and the documents blocked-state
 * gate. The encrypted paths aren't covered here on purpose: unlocking a
 * device's CMK depends on an IndexedDB-held device key established by
 * Account → Security's enrollment flow, which a fresh Playwright context
 * never has — those paths are covered by the unit suites instead
 * (`plugins/sovereign-plugin-wallet.local/app/_lib/__tests__/`).
 */
test.describe('Wallet — cards', () => {
  test('an empty wallet shows one empty state, not empty state plus zero-count tiles', async ({
    userPage: page,
  }) => {
    await page.goto('/wallet');
    await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible({ timeout: 15_000 });

    // Either the wallet is empty (empty state, no tiles) or it has items
    // (tiles, no empty state) — never both at once.
    const emptyState = page.getByRole('heading', { name: 'Your wallet is empty' });
    const tiles = page.getByRole('region', { name: 'Wallet categories' });
    if (await emptyState.isVisible()) {
      await expect(tiles).toBeHidden();
    } else {
      await expect(tiles).toBeVisible();
    }
  });

  test('a missing display name reports inline instead of replacing the page with an error', async ({
    userPage: page,
  }) => {
    await page.goto('/wallet/cards');
    await page.getByRole('button', { name: 'Add card' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Payload filled, title deliberately left empty. The browser's own
    // `required` blocks submit, so clear it to reach the app's validation.
    await dialog.getByLabel('Card payload').fill('12345');
    await dialog.evaluate((node) => {
      node.querySelectorAll('input,textarea').forEach((el) => el.removeAttribute('required'));
    });
    await dialog.getByRole('button', { name: 'Add card' }).click();

    // The pre-fix action threw, which reached the client as an opaque digest
    // and swapped the whole page for the error boundary.
    await expect(dialog.getByText('Display name is required.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeHidden();
  });

  test('create → view → scan → edit → delete a card', async ({ userPage: page }) => {
    const title = `E2E card ${Date.now()}`;
    await page.goto('/wallet/cards');

    await page.getByRole('button', { name: 'Add card' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Display name').fill(title);
    await dialog.getByLabel('Issuer').fill('E2E Issuer');
    await dialog.getByLabel('Card payload').fill('9876543210');
    await dialog.getByRole('button', { name: 'Add card' }).click();

    // The action returns the new id and the client navigates — no redirect().
    await page.waitForURL('**/wallet/cards/**', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText('9876543210')).toBeVisible();

    // Timestamps are rendered now, having previously been fetched and dropped.
    await expect(page.getByText(/^Added /)).toBeVisible();

    // The scan view — the interaction a loyalty-card wallet exists for.
    await page.getByRole('button', { name: 'Show for scanning' }).click();
    const scan = page.getByRole('dialog', { name: title });
    await expect(scan).toBeVisible();
    await expect(scan.getByText('9876543210')).toBeVisible();
    await scan.getByRole('button', { name: 'Done' }).click();
    await expect(scan).toBeHidden();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Display name').fill(`${title} edited`);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: `${title} edited` })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await page.waitForURL('**/wallet/cards', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: `${title} edited` })).toBeHidden();
  });
});

test.describe('Wallet — documents', () => {
  test('upload is blocked with an explanation until encryption is set up', async ({
    userPage: page,
  }) => {
    await page.goto('/wallet/documents');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 15_000 });

    // A fresh browser context has no enrolled device key, so the gate must
    // block — and say why, with a route to fix it.
    await expect(page.getByRole('button', { name: 'Add document' })).toBeHidden();
    await expect(page.getByRole('link', { name: /Account → Security/ })).toBeVisible();
  });
});
