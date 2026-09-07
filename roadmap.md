# Sovereign Wallet — Roadmap

Chronological, dependency-ordered task queue for building the Sovereign
Wallet plugin. Each task is scoped to **one branch = one PR**, small enough
for an AI agent to pick up with minimal supervision. Full requirements:
[SPEC.md](SPEC.md).

## How to read this file

- **`[PLATFORM]`** tasks change the main **`claude-sv`** monorepo (the
  platform checkout this plugin is composed into). They follow that
  repo's own `CLAUDE.md` / `docs/development-workflow.md` conventions
  (branch naming, version bumps, `docs/roadmap.md` + `docs/epics/` updates,
  draft PRs). **Do these in the `claude-sv` repo, not here.**
- **`[PLUGIN]`** tasks change **this repo** (`sovereign-wallet.local`, which
  becomes the public `sovereign-wallet` repo).
- Tasks are **sequenced** — don't start a task whose `Depends on` isn't ✅,
  unless tagged `[parallel]`.
- Status: `⬜ not started` / `🟨 in progress` / `✅ done`.
- **Unlike Sovereign Docs, this plugin's chosen phase-1 scope (cards &
  encrypted documents) is genuinely blocked on unbuilt platform capability.**
  Phase 1 below is real platform engineering, not a formality — expect it to
  take materially longer than the plugin-side phases that follow it.

---

## Phase 0 — Plugin repo bootstrap `[PLUGIN]`

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-00 | Bootstrap this repo: `package.json`, `tsconfig` (extend `@sovereignfs/tsconfig`), ESLint/Prettier config matching `claude-sv` conventions, `manifest.json` skeleton (id `fs.sovereign.wallet`, `type: sovereign`, `shell: default`), CI workflow, README pointing to SPEC.md + this roadmap. | — | ✅ |

---

## Phase 1 — Platform prerequisites for cards & documents `[PLATFORM]`

Must land in `claude-sv` before Phase 2's encrypted-document work (W-05) can
ship. Loyalty cards alone (W-03/W-04) don't strictly need encryption and can
start once W-00 is done, in parallel with this phase.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-01 | **[PLATFORM]** Implement RFC 0044 (`sdk.storage`): replace the `NotImplementedError` stubs in `packages/sdk/src/unimplemented.ts` with a real `put()`/`get()` backed by an actual storage surface. Update RFC 0044 status + `docs/roadmap.md` / epic task 8.7. | — | ✅ |
| W-02 | **[PLATFORM]** Implement RFC 0060 (client-side encryption core), step 1: manifest permission/capability for client-side encryption use; encrypted profile metadata tables (wrapped CMK, device enrollment records, recovery-secret wrapper metadata) + SDK types. | — | ✅ |
| W-03 | **[PLATFORM]** RFC 0060 step 2: Account setup/unlock/recovery-secret UX (generate CMK in browser, wrap with recovery secret, device enrollment flow). | W-02 | ✅ |
| W-04 | **[PLATFORM]** RFC 0060 step 3: SDK helpers for encrypting/decrypting `Blob`/`ArrayBuffer`/JSON metadata (`sdk.crypto.client` or `sdk.e2ee` — name is an open question in RFC 0060, resolve during this task), wrap/unwrap per-object DEKs, locked/unlocked state detection. | W-03 | ✅ |
| W-05 | **[PLATFORM]** RFC 0060 step 4: integrate with `sdk.storage` (W-01) for encrypted binary object storage — upload/download ciphertext through the storage surface. | W-01, W-04 | ✅ |
| W-06 | **[PLATFORM]** RFC 0060 step 5: export/delete behavior through the existing `sdk.portability` hooks (already implemented per RFC 0007 — confirm `blobs`/wrapped-key handling covers encrypted objects, extend if not). Update RFC 0060 status to Implemented, update `docs/roadmap.md` / epic task 8.9. | W-05 | ✅ |

---

## Phase 2 — Plugin v0.1: cards & documents (Epic 21 scope) `[PLUGIN]`

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-07 | DB schema: `wallet_items`, `wallet_card_payloads` (see SPEC data model). Migration + Drizzle schema file. | W-00 | ✅ |
| W-08 | Wallet home view: empty state, card/document category tiles, nav using `@sovereignfs/ui` primitives. | W-07 | ✅ |
| W-09 | Loyalty card CRUD (create/view/edit/delete): display name, issuer, payload, format, notes. `[parallel]`-safe with Phase 1 — no encryption required for the payload itself. | W-08 | ✅ |
| W-10 | Browser-side QR/barcode rendering (resolve SPEC open question 11: library + supported formats first). No payload sent to an external service. | W-09 | ✅ |
| W-11 | Locked-state UI path for encrypted card payloads (resolve SPEC open question 10: encrypted-by-default or opt-in). | W-10, W-04 | ✅ |
| W-12 | Sensitive-document upload flow: gate on client-side encryption setup (W-03) being complete; block upload otherwise with a clear explanation. | W-06, W-08 | ✅ |
| W-13 | Browser-side binary encryption of document images before upload (encrypt → upload ciphertext via `sdk.storage`); encrypted human-readable metadata. | W-12 | ✅ |
| W-14 | Browser-side decrypt-and-display flow using Blob URLs; recovery/locked-state UX explaining data-loss implications. | W-13 | ✅ |
| W-15 | Optional front/back card image support via `sdk.storage` (W-01). | W-01, W-09 | ✅ |
| W-16 | Portability hooks: export (encrypted metadata + wrapped keys + ciphertext storage objects), import (remap object IDs, preserve ciphertext), delete (idempotent removal of rows, wrapped keys, storage objects). Uses the already-implemented `sdk.portability`. | W-13, W-06 | ✅ |
| W-17 | v0.1 hardening pass: tenant-scoping test sweep, locked-state edge cases, recovery-warning copy review, no-plaintext-leak audit (verify no route handler or log ever sees decrypted bytes). | W-16 | ✅ |

**Cards & documents v0.1 is feature-complete after W-17.**

---

## Phase 2.5 — Mobile device-capability primitives `[PLATFORM/PLUGIN]`

Same shape as Phase 1: genuinely blocked on unbuilt platform capability, not a
formality. Both tasks below were raised as "can we do X on mobile" questions
for Wallet, but per RFC 0058 (`docs/rfcs/0058-native-mobile-app-shell.md` in
`claude-sv`) and `CLAUDE.md`'s device-API model, **plugins call `sdk.device.*` only — never
raw Web APIs (`getUserMedia`, `BarcodeDetector`, `matchMedia`) directly.**
That SDK surface doesn't exist yet: RFC 0058 is `status: Draft`, and every
epic-20 task that would build it (20.1–20.9) is unscheduled (`—` / 📋) in
`docs/roadmap.md`, gated on the separate `sovereign-mobile` Capacitor repo.

The good news: RFC 0058's own device-tier table describes `sdk.device.*` as
"detects environment, routes to correct tier ... ✅ works in browser too
(falls back to Web API)" — the **web-tier implementation doesn't need the
Capacitor shell or `sovereign-mobile` repo to exist first.** It's the same
primitive's first tier, buildable in `claude-sv` today, with native
Capacitor routing added later (epic 20.3/20.6) without changing the SDK
surface plugins call. Building this properly means adding that web-tier slice
to `packages/sdk` now, rather than a plugin-local shortcut that would need to
be redone (and likely duplicated into other plugins) once `sdk.device.*`
actually ships.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-54 | **[PLATFORM/PLUGIN]** Add a minimal `sdk.device` environment-detection primitive to `packages/sdk` — web tier only (resolve exact name/shape during this task, e.g. `sdk.device.getEnvironment()`): distinguishes an installed/standalone PWA from an ordinary browser tab (`matchMedia('(display-mode: standalone)')` + iOS's legacy `navigator.standalone` fallback). Scoped to this one slice of RFC 0058's `sdk.device.*` surface — native/Capacitor environment routing stays out of scope (epic 20.3, blocked on the `sovereign-mobile` repo). Wallet's specific consumption of this is intentionally left open — detection alone has no user-facing purpose; decide it alongside W-55's scan-entry UX when this is picked up. | RFC 0058 (Draft, epic 20 unscheduled) — build the web-tier slice in `claude-sv` as part of this task | ⬜ |
| W-55 | **[PLATFORM/PLUGIN]** Add camera-capture and barcode/QR-decode primitives to `sdk.device.*` — web tier only (`sdk.device.capturePhoto()` is RFC 0058's own worked example; add a scan/decode variant alongside it, exact API shape resolved during this task): `getUserMedia` + `BarcodeDetector` where supported, falling back to a JS decoder (e.g. `jsQR` — small, MIT; `BarcodeDetector` has no Safari/iOS support, so this fallback is not optional for a wallet app). Requires a secure context (HTTPS or localhost) — a self-hosted instance served over plain HTTP loses camera access entirely with no error to surface; document this in `docs/self-hosting.md`. Then consume it in Wallet: a "Scan card" option on "Add card" that decodes a barcode/QR from the live camera and prefills `payload`/`barcodeFormat` instead of manual entry, with the existing manual form kept as the fallback. (`capture="environment"` on the existing front/back card-image and document-upload file inputs is a separate, no-platform-dependency win — plain HTML attribute, ship independently whenever convenient, not gated on this task.) | W-54 (same `sdk.device` module); RFC 0058 (Draft, epic 20 unscheduled) | ⬜ |

---

## Phase 3 — Plugin v0.2: finance ledger POC `[PLUGIN]`

No platform blockers — can run in parallel with Phase 1/2 if the team wants
two tracks moving, but numbered after per the chosen priority.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-18 | DB schema: `wallet_profiles`, `wallet_accounts`, `wallet_categories`, `wallet_counterparties`, `wallet_transactions`, `wallet_import_batches`. Migration + Drizzle schema file. | W-00 | ⬜ |
| W-19 | Resolve SPEC open questions 1–4 (currency model, decimal precision, minor-units-vs-decimal storage, category defaults) before building forms/validation around them. | W-18 | ⬜ |
| W-20 | Wallet profile creation (auto on first ledger use) + manual account CRUD (name, type, currency, opening balance, status; archive/delete with confirmation). | W-19 | ⬜ |
| W-21 | Manual transaction CRUD: date, amount, direction, account, category, counterparty, notes; types income/expense/transfer/adjustment. | W-20 | ⬜ |
| W-22 | Paired transfer validation (two user-owned accounts, `transfer_group_id` linkage). | W-21 | ⬜ |
| W-23 | Balance calculation from opening balance + posted transactions. | W-21 | ⬜ |
| W-24 | Categories (add/rename/merge/archive/delete) + counterparties (add/reuse). | W-20 | ⬜ |
| W-25 | Transaction filter/search by account, date, category, counterparty, amount, text. | W-21 | ⬜ |
| W-26 | CSV import with user-reviewed column mapping (resolve SPEC open question 5: store original row data for audit?). | W-21 | ⬜ |
| W-27 | CSV export: accounts, categories, counterparties, transactions. | W-21 | ⬜ |
| W-28 | Ledger dashboard: totals by account type, recent activity, monthly income/expense summary. | W-23, W-24 | ⬜ |
| W-29 | v0.2 hardening pass: owner-scoping test sweep, transfer/balance correctness tests, import-mapping edge cases, export round-trip test. | W-26, W-27, W-28 | ⬜ |

**Finance ledger v0.2 (POC) is feature-complete after W-29.**

---

## Phase 4 — Plugin v0.3: ledger organization & audit `[PLUGIN]`

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-30 | Budgets by category and month. | W-29 | ⬜ |
| W-31 | Recurring transactions. | W-29 | ⬜ |
| W-32 | Transaction reconciliation states: pending, posted, reviewed, reconciled. | W-29 | ⬜ |
| W-33 | Statement import batches + duplicate detection. | W-26 | ⬜ |
| W-34 | Audit events for import, export, account changes, transaction deletion, reconciliation. | W-29 | ⬜ |
| W-35 | Receipt/statement attachments via `sdk.storage`. | W-01, W-29 | ⬜ |

---

## Phase 5 — Ledger Sovereign ID integration `[PLATFORM/PLUGIN — external dependency]`

**Not actionable yet.** Blocked on `local/sovereign-plugin-proposals/sovereign-id.md`,
which is itself an unbuilt, separate external plugin with no roadmap of its
own. Do not start these tasks until Sovereign ID has shipped a stable
identity/credential/signing interface.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-36 | Link wallet profile to a Sovereign ID after explicit user approval. | Sovereign ID plugin (not started) | ⬜ |
| W-37 | Issue a wallet-readiness credential or local signed claim. | W-36 | ⬜ |
| W-38 | Sign wallet-sensitive actions through Sovereign ID where available. | W-36 | ⬜ |
| W-39 | Consent screens before sharing wallet credentials or financial claims. | W-36 | ⬜ |
| W-40 | Record signed approval artifacts for sensitive wallet operations. | W-38 | ⬜ |

---

## Phase 6 — Ledger external financial connections `[PLUGIN]`

SDK-ready today (`sdk.connections`, `sdk.secrets` both implemented) — only
gated on reaching this point in sequence, not on platform work.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-41 | External provider connection records via `sdk.connections`. | W-29 | ⬜ |
| W-42 | Store provider tokens/secrets via `sdk.secrets` only. | W-41 | ⬜ |
| W-43 | Sync accounts/balances from approved providers. | W-42 | ⬜ |
| W-44 | Sync transactions from approved providers with duplicate detection and import review. | W-43, W-33 | ⬜ |
| W-45 | Provider disconnect + data-retention/deletion policy for provider-sourced data. | W-43 | ⬜ |

---

## Phase 7 — Ledger payment intents & approvals `[PLATFORM/PLUGIN]`

Blocked on Phase 5 (Sovereign ID signing) and a platform webhook primitive.

| ID | Task | Depends on | Status |
| --- | --- | --- | --- |
| W-46 | **[PLATFORM]** Implement RFC 0050 (public plugin webhooks) — needed for payment-provider status callbacks. Update RFC status + `docs/roadmap.md` / epic task 2.15. | — | ⬜ |
| W-47 | Payment intent creation (no automatic execution). | W-41 | ⬜ |
| W-48 | Approval/rejection flow: recipient, amount, provider, fees, risk warnings, explicit confirmation. | W-47, W-40 | ⬜ |
| W-49 | Store signed approval/rejection records via Sovereign ID (W-40). | W-48 | ⬜ |
| W-50 | Hand approved intents to configured payment provider. | W-49 | ⬜ |
| W-51 | Track payment status from provider callbacks (W-46) or polling. | W-50 | ⬜ |

---

## Deferred / optional (not blocking)

- **W-52** — **[PLATFORM]** RFC 0054 (plugin-scoped roles/grants) — only
  needed if shared wallets / accountant / approval-only roles are prioritized
  later. Neither track needs this for the phases above.
- **W-53** — **[PLUGIN]** Resolve SPEC open question 9 (split cards/documents
  and ledger into two plugins) — revisit once both tracks are past their POC
  and the access-model divergence (if any) is concrete rather than
  theoretical.

---

## Cross-repo sync note

Epic 21 in `claude-sv` (`docs/epics/sovereign-wallet.md`, tasks 21.1–21.4)
currently frames Wallet as a first-party in-monorepo plugin. This roadmap
uses the external-repo model instead (per SPEC.md's
[Repo-model deviation](SPEC.md#repo-model-deviation-from-rfc-0061)). Someone
should reconcile Epic 21's task descriptions (or close it in favor of this
repo) **before** Phase 1/2 work starts, so the platform roadmap doesn't carry
a stale, conflicting plan. This is a `[PLATFORM]` documentation task, not
tracked with a `W-*` ID here since it's a one-time reconciliation, not part
of the build sequence.

## Changelog

| Date | Change |
| --- | --- |
| 2026-07-12 | Initial roadmap, derived from merged SPEC.md + platform audit. |
| 2026-07-12 | W-00 done: repo bootstrap (package.json, tsconfig, manifest.json, icon, CI, README). No local ESLint/Prettier override added — `plugins/*` is already covered by `claude-sv`'s single root config per its "one config, entire monorepo" rule. |
| 2026-07-12 | W-07 done: `wallet_items`/`wallet_card_payloads` Drizzle schema (`app/_db/schema.ts`, re-exported from `db/schema.ts` for `drizzle-kit generate`) + generated SQLite migration. Manifest resolves to SQLite only (`isolation: isolated, dialect: sqlite`), so no Postgres schema/migration variant is needed. Verified: migration applies cleanly against the provisioned isolated store (`data/plugins/fs.sovereign.wallet.db`) on `pnpm dev` startup. |
| 2026-07-12 | W-08 done: home view (`app/page.tsx`) — `PageHeader` + `EmptyState` (whole-wallet empty case) + two `Card`-tile categories (Cards, Documents) linking to `/wallet/cards` and `/wallet/documents` (built in W-09/W-12), each showing a per-kind item count from `app/_lib/counts.ts`. Verified: typecheck/lint/format clean; counts query logic verified directly against the isolated SQLite store (tenant/owner scoping confirmed correct). Browser UI verification blocked by a sandboxed-preview auth quirk (session cookie doesn't persist across the auth↔runtime redirect in this environment) — not a code defect; unauthenticated `/wallet` access was already confirmed clean in W-00. |
| 2026-07-12 | W-09 done: loyalty card CRUD — `app/_lib/actions.ts` (`listCards`/`getCard`/`createCard`/`updateCard`/`deleteCard`, tenant+owner scoped throughout), `app/cards/page.tsx` (list + `NewCardDialog`), `app/cards/[cardId]/page.tsx` + `CardDetailView` (view/inline-edit/delete with `ConfirmDialog`). Payload/metadata stored plaintext for now (`payloadEncrypted: false`, `encryption_version: null`) — cards are "encryption recommended, not required" per SPEC's data-class table; `wallet_items.encrypted_metadata` holds a plain JSON `{title, issuer, notes}` blob until W-11 wires real encryption into the same column (no schema change anticipated there). Barcode format is a fixed enum (qr/code128/code39/ean13/upc/other) pending W-10's format-support decision. Verified: typecheck/lint/format clean; full create→list→update→get→delete flow verified against a scratch SQLite DB using the exact query shapes from actions.ts (all correct, including `.returning()` and the join). Browser UI verification blocked by the same sandboxed-preview auth quirk noted under W-08. |
| 2026-07-12 | W-10 done: resolved SPEC open question 11 — `qrcode` (QR, canvas) + `jsbarcode` (Code 128/39, EAN-13, UPC, inline SVG), both dynamically imported client-only so neither lands in a server bundle; `other` falls back to showing the raw payload text. New `CodeDisplay` component wired into `CardDetailView`'s view mode. No payload ever leaves the browser. Verified: typecheck/lint/format clean; both libraries' import shape and `qrcode`'s encode path confirmed directly in Node. Browser UI verification blocked by the same sandboxed-preview auth quirk noted under W-08/W-09. |
| 2026-07-12 | W-01 in progress: implemented RFC 0044 (`sdk.storage`) in `claude-sv` — put/get/delete/list/getSignedUrl, `plugin_storage_objects` metadata table, local-filesystem backend (Tier 0), env-configurable quotas, a signed-download route (`/api/storage/[token]`), and account-deletion cleanup. Full `claude-sv` suite green (format/lint/typecheck/834 tests) plus a live boot smoke-test and a security-check pass (matcher-only middleware change, no redirect/CSP/cookie code touched). Per `claude-sv`'s own workflow (branch-per-task, draft PR, never auto-merged — confirmed with the developer, distinct from this repo's direct-to-main convention), opened as a **draft PR, not yet merged**: [sovereignfs/sovereign#199](https://github.com/sovereignfs/sovereign/pull/199). W-01 flips to ✅ here once that PR merges. |
| 2026-07-13 | Removed `.github/workflows/ci.yml` (and the now-empty `.github/`) per developer decision — W-00's CI-workflow deliverable is dropped from this repo for now. |
| 2026-07-13 | W-01, W-02 done: confirmed merged in `claude-sv` — [sovereignfs/sovereign#199](https://github.com/sovereignfs/sovereign/pull/199) (`sdk.storage`, RFC 0044) and [sovereignfs/sovereign#200](https://github.com/sovereignfs/sovereign/pull/200) (RFC 0060 steps 1–2: manifest permission + encrypted-profile tables/types). Both had been sitting at 🟨/⬜ here despite merging — this roadmap wasn't updated when they landed; corrected retroactively. |
| 2026-07-13 | W-03 done: RFC 0060 step 2 (Account setup/unlock/recovery-secret UX) implemented in `claude-sv` — `sdk.e2ee` persistence surface, browser-only WebCrypto CMK generation/wrap/unwrap (`e2ee-crypto.ts`, PBKDF2-HMAC-SHA256 KDF, resolves RFC 0060 open question 2), device-key persistence via IndexedDB (`e2ee-device.ts`), and a new Account → Security "Encryption" section for setup/unlock/device enrollment/revocation. Device enrollment deliberately scoped to "recovery-secret unlock enrolls the current device," not full device-to-device pairing (see PR description for rationale). Merged as [sovereignfs/sovereign#203](https://github.com/sovereignfs/sovereign/pull/203) after fixing two bugs caught during review/QA: a missing unique index on `e2ee_recovery_wrappers`/`e2ee_profiles` that crashed the recovery-wrapper upsert on first use (caught via live manual testing, not the automated suite), and local-only plugin data (from `sovereign-tasks.local`, `example-basic`, etc.) that had leaked into committed generated files (`plugin-schedules.ts`, `plugin-capabilities.ts`, `pnpm-lock.yaml`) from an earlier session, breaking CI typecheck — `validate-plugin-boundary.ts` was extended to also guard the two generated files it previously missed. `docs/roadmap.md` / epic task 8.9 intentionally stays unmarked in `claude-sv` — the epic's full goal isn't achieved until W-04 exists. |
| 2026-07-13 | W-04 done: per-object DEK generation/wrap/unwrap (`generateDek`/`wrapDekWithCmk`/`unwrapDekWithCmk`), `Blob`/JSON encrypt-decrypt helpers (`e2ee-object.ts`), and normalized locked/unlocked state detection (`e2ee-state.ts`, `getE2eeLocalState`) merged in `claude-sv` as [sovereignfs/sovereign#205](https://github.com/sovereignfs/sovereign/pull/205). Caught and fixed a real bug along the way: the CMK's key usages only included `encrypt`/`decrypt`, missing `wrapKey`/`unwrapKey`, so wrapping a DEK failed immediately. |
| 2026-07-13 | W-05 done: `sdk.storage`'s `metadata` field — accepted on `put()` but never returned by `get()`/`list()` — now round-trips, which is what makes it usable for an encrypted object's wrapped DEK/algorithm version. No dedicated storage method needed; documented the combined `encryptBlob` → `sdk.storage.put` → `sdk.storage.get` → `decryptBlob` workflow instead. Merged as [sovereignfs/sovereign#206](https://github.com/sovereignfs/sovereign/pull/206) (shipped as an SDK **minor** bump per NFR-04, since adding a required `StorageObject` field is technically breaking for anyone constructing one directly). |
| 2026-07-13 | W-06 done — **epic 8.9 (RFC 0060) core scope complete.** Account export now includes the user's encryption profile/recovery-wrapper/device-enrollments (still wrapped ciphertext only); account deletion already removed this data unconditionally from an earlier task. Import is additive-safe — skips entirely if the importing user already has a profile. Confirmed `plugin_storage_objects` needs no platform change (a plugin's own export/import handler already composes `sdk.storage` + `sdk.portability` directly). Merged as [sovereignfs/sovereign#208](https://github.com/sovereignfs/sovereign/pull/208); RFC 0060 status flipped to Implemented, `docs/roadmap.md`/`docs/epics/data-sovereignty.md` mark epic 8.9 ✅. Found and fixed two unrelated bugs along the way: `vitest.config.ts`'s test include glob never matched nested `__tests__` dirs (so `runtime/src/portability/__tests__/` tests had never run), and a stray ephemeral agent-task worktree was breaking `format:check`/`lint`. Step 7 of the RFC's adoption path (Wallet consuming this core surface) is this roadmap's own remaining Phase 2 work (W-11 onward), not part of epic 8.9. |
| 2026-07-14 | W-11 done: resolved SPEC open question 10 — loyalty-card encryption is opt-in per card, not encrypted by default (matches the existing data-class table). New `useE2eeUnlock` hook (`app/_lib/useE2eeUnlock.ts`) wraps `sdk.e2ee` status + `getE2eeLocalState`/`unwrapCmkWithDeviceKey` to resolve this device's unlock state and CMK entirely client-side. "Add card" gained an "Encrypt this card" checkbox (disabled until client-side encryption is set up and unlocked); when checked, a fresh per-card DEK is generated, wrapped with the CMK, and title/issuer/notes/payload are encrypted client-side before the server ever sees them (`wallet_items.encryption_version`/`wrapped_dek`, `wallet_card_payloads.payload_encrypted` now load-bearing, not placeholders). `getCard`/`listCards` never attempt to parse an encrypted item's metadata server-side — the list shows a "🔒 Encrypted card" placeholder, and the detail view shows a locked-state message until this device's CMK is unlocked, then decrypts and displays normally; editing re-encrypts with the same DEK. Caught and fixed a real bug during manual verification: the card detail page's title header was read server-side (`card.title \|\| 'Untitled card'`) in a Server Component, which can never see a decrypted title for an encrypted card — moved `PageHeader` into `CardDetailView` itself so it renders the client-decrypted title once available. Verified live end-to-end (fresh browser origin, since IndexedDB/localStorage are port-scoped and this admin's earlier device enrollment didn't carry over): set up encryption, created an encrypted card, confirmed the DB stores only ciphertext (`sqlite3` inspection of `wallet_items.encrypted_metadata` and `wallet_card_payloads.payload`), confirmed the locked-state placeholder after clearing the device key, re-unlocked via the recovery secret, and confirmed edit-and-re-encrypt round-trips correctly. |
| 2026-07-14 | W-12, W-13, W-14 done together (developer-confirmed scope decision — the three are tightly coupled and a gate with nothing behind it, or an upload path with no way to view the result, would each be a half-finished feature). New `/wallet/documents` list + `/wallet/documents/[documentId]` detail routes, `app/_lib/documentActions.ts` (`listDocuments`/`getDocument`/`createDocument`/`deleteDocument`), `DocumentUploadGate` (the W-12 gate — renders the real upload button only once `useE2eeUnlock` reports `unlocked`, otherwise a blocking explanation with a link to Account → Security; unlike loyalty cards, documents have no plaintext fallback at all per SPEC), `NewDocumentDialog` (W-13 — generates a fresh per-document DEK, wraps it with the CMK, `encryptBlob`s the file and `encryptJson`s the title/notes/original-filename/content-type, uploads only ciphertext via `sdk.storage.put` with `{iv, blobAlgorithmVersion}` in the storage object's `metadata`), and `DocumentDetailView` (W-14 — fetches the ciphertext from `sdk.storage`'s signed URL, decrypts client-side, and renders an `<img>` Blob URL for images or a download link otherwise; revokes the Blob URL on unmount). New `storage:readWrite` manifest permission. Extracted `formString`/`now` out of `actions.ts` into `app/_lib/formUtils.ts` so `documentActions.ts` could reuse them — a `'use server'` file may only export async functions, so the two `'use server'` action files can't import helpers from each other directly. Verified live end-to-end (same fresh-origin re-setup as W-11): confirmed the gate blocks with a clear explanation before encryption is set up, uploaded a document once unlocked, confirmed `sqlite3`/`strings` inspection of both the `wallet_items` row and the physical `plugin_storage_objects` file on disk show only ciphertext (no plaintext title, notes, or file content anywhere), confirmed decrypt-and-display renders the correct title/notes and a working download link for a non-image file, and confirmed delete removes both the DB row and the physical storage file with no orphans. |
| 2026-07-14 | W-15, W-16, W-17 done. **W-15:** optional front/back card image support — `wallet_card_payloads.front_image_key`/`back_image_key` columns + migration; `uploadCardImage()` in `actions.ts` uploads via `sdk.storage.put()` (encrypted images go through the card's own DEK, storing `{iv, blobAlgorithmVersion, contentType}` in the storage object's `metadata`); `resolveCardImage()` resolves a storage key back into a signed URL for display; new `useDecryptedImage` hook renders the front/back images in `CardDetailView`. **W-16:** `app/_lib/portability.ts` registers `exportWalletData`/`importWalletData`/`deleteWalletData` via `sdk.portability`'s `provideExport`/`provideImport`/`provideDelete` (called from a new `app/layout.tsx`, since registration needs a request-scoped plugin route) — export bundles card/document rows plus their storage-object bytes as opaque ciphertext-or-plaintext; import re-uploads blobs under **fresh** `sdk.storage` keys (never reuses source-instance keys) and remaps item IDs via `ctx.remapId`; delete removes all rows plus storage objects, tolerating partial storage-delete failures. **W-17:** hardening pass — added a tenant/owner-scoping test sweep (`actions.test.ts`) and found two real bugs during the audit: `resolveCardImage()` called `sdk.storage.getSignedUrl()` before confirming the object existed, so a missing image 500'd the whole card page (fixed: check existence first, return `null` gracefully); `updateCard()` uploaded submitted images to storage *before* verifying the caller owned the card, so a crafted cross-user request wasted/orphaned a storage upload before the DB update correctly no-op'd (fixed: ownership check now runs first). Confirmed via `grep` that `decryptBlob`/`decryptJson` only ever appear in `'use client'` files and no server code logs decrypted content. All verified: typecheck/lint/format clean, `pnpm vitest run plugins/sovereign-wallet` (10/10 passing across `portability.test.ts` + `actions.test.ts`), full monorepo `pnpm test` (948/957 passing, 9 skipped) all green. |
| 2026-09-07 | v0.1 review-remediation pass (manifest `0.3.4` → `0.4.0`). **Correctness:** "Encrypt this card" no longer falls through to a plaintext write when the CMK lapses between render and submit; `updateCard` now always writes both `encryption_version` and `wrapped_dek` (leaving them set on a plaintext write made `getCard` parse plaintext as ciphertext, permanently 500ing that card); card/document submissions are fully validated *before* any `sdk.storage.put`, and uploads are rolled back if the DB write then fails (`createCard` had the pre-upload-validation bug W-17 fixed only in `updateCard`). **Security:** client-supplied image content types are allowlisted before storage and before `URL.createObjectURL` — the signed-download route echoes a stored `contentType` verbatim with no `Content-Disposition`, and `/api/storage` is outside the proxy matcher so no CSP applies, making a stored `text/html` an active document on the runtime origin; imported bundles go through the same allowlist and per-item structural validation (skip-not-throw, since import has no transaction). **Error UX:** every action returns the repo's `ActionResult` shape instead of throwing (a throw reached the client as an opaque digest and replaced the page with the 500 boundary); added the required `app/error.tsx` and an `app/loading.tsx`; size limits are enforced against Next's *default* 1 MB Server Action body cap (`runtime/next.config.ts` sets no `bodySizeLimit`) with messages naming the actual size. **Spec:** WLT-08's issuer/type/country/number fields are now captured and encrypted; documents gained an edit flow (`updateDocument`, metadata re-sealed under the existing DEK, blob untouched); `kind_hint` is now written. **UX:** one shared `WalletE2eeProvider` replaces three independent unlock checks per documents page and re-checks on window focus; a "Show for scanning" view (large barcode, fixed light stage, wake lock) and copy-to-clipboard; search on both lists; locked cards now show barcode format + date so they're distinguishable; timestamps and file size surfaced; DS `Icon` replaces every 🔒 emoji and the hand-rolled `FileField` SVG; the home page shows the empty state *or* the tiles, never both; spinners replace blank `return null` states. **Docs:** README's "no functionality implemented yet" and both stale identity tables corrected; SPEC's `sdk.storage`/`sdk.e2ee` rows marked implemented; absolute developer path removed from this file. **Tests:** 10 → 56, adding the previously uncovered `documentActions` scoping sweep, the encryption-column regression, upload-ordering, content-type allowlisting and bundle validation — each verified to fail against the pre-fix code. Two review findings were investigated and **withdrawn**: the plugin is *not* Postgres-broken (a `sqliteTable()` schema against a Postgres-backed client is the documented, empirically-verified platform pattern — `docs/plugin-database.md`), and request-scoped portability registration matches `plugins/warden` exactly, so the cold-registry backup gap is platform-side, not Wallet's. |
| 2026-07-14 | Added Phase 2.5 (W-54, W-55): two mobile device-capability questions (standalone-PWA-vs-browser-tab detection; native-camera barcode/QR scan-to-autofill for cards) turned out to both route through `sdk.device.*` (RFC 0058), which is entirely unbuilt (Draft status, epic 20 unscheduled) — same "genuinely blocked on platform" shape as Phase 1, not something to work around with plugin-local `getUserMedia`/`matchMedia` calls. Documented as platform-first tasks so they're picked up via the real primitive rather than a shortcut. |
