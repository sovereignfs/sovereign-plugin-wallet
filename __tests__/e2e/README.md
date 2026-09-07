# Wallet end-to-end spec

`wallet.spec.ts` drives Wallet's plaintext-card flows and the documents
blocked-state gate through the real UI, using the platform's Playwright
harness and its pre-authenticated `userPage` fixture.

It lives **here rather than in the platform's `__tests__/e2e/`** because this
plugin is composed from a `.local` checkout that the platform repo doesn't
track. A committed platform spec referencing `/wallet` would fail CI on any
checkout without this plugin, and `scripts/validate-plugin-boundary.ts`
exists to stop exactly that kind of leak.

## Running it

Copy or symlink it into the platform's e2e directory for the run:

```bash
cp plugins/sovereign-plugin-wallet.local/__tests__/e2e/wallet.spec.ts __tests__/e2e/
npx playwright test __tests__/e2e/wallet.spec.ts --reporter=line
```

`global-setup.ts` runs `pnpm sv seed`, which **refuses to run against an auth
database that already holds real user accounts** — it inserts accounts with a
well-known password. On a developer machine with real dev accounts the run
stops there by design. Use a disposable database (or CI, which starts clean)
rather than setting `SOVEREIGN_SEED_ALLOW_PROD`.

## What it does not cover

The encrypted card and document paths. Unlocking a device's CMK depends on an
IndexedDB-held device key established by Account → Security's enrollment
flow, which a fresh Playwright context never has. Those paths are covered by
the unit suites in `app/_lib/__tests__/` instead.
