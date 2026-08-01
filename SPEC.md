# Sovereign Wallet

**Version:** 0.2\
**Date:** July 2026\
**Author:** kasunben\
**Purpose:** Canonical specification for the Sovereign Wallet plugin — merges
two prior drafts (the private finance-ledger proposal and platform RFC 0061 /
Epic 21's loyalty-card + encrypted-document vault) into a single product, data
model, and build plan.\
**Status:** Draft

---

Sovereign Wallet is a privacy-first personal wallet plugin with **two feature
tracks under one product**:

1. **Cards & documents** — QR/barcode loyalty cards and client-side encrypted
   snapshots of sensitive documents (passports, IDs). This track originates
   from platform RFC 0061 and is already tracked as **Epic 21** in the
   platform's own roadmap (`docs/roadmap.md`, `docs/epics/sovereign-wallet.md`).
2. **Finance ledger** — private manual accounts, transactions, categories,
   and CSV import/export, growing later into Sovereign-ID-linked credentials
   and payment approvals. This track originates from the local plugin
   proposal (`local/sovereign-plugin-proposals/sovereign-wallet.md`, now
   retired — its content lives here).

Sovereign Wallet is not a bank, not a payment processor, not a crypto wallet,
not a government-ID verification system, and not a regulated money-movement
product in this phase.

The plugin is `type: sovereign` — maintained in a separate external
repository, same pattern as Sovereign Docs and Plainwrite (see
[Repo-model deviation from RFC 0061](#repo-model-deviation-from-rfc-0061)).

## Why these two tracks share one plugin

Both tracks are privately-owned-by-the-user records under a single "wallet"
mental model (the physical-wallet metaphor: cards you carry + money you
track), share the same owner-scoping/access rules, the same `wallet_*` table
prefix and `tenant_id` convention, and the same shell placement. They do
**not** share a data model — a `wallet_documents` row and a
`wallet_transactions` row never reference each other. Whether they should
eventually split into two plugins is an open question (see
[Open questions](#open-questions), item 9).

## Repo-model deviation from RFC 0061

RFC 0061 frames Wallet as a first-party in-monorepo plugin (`plugins/wallet`
inside `claude-sv`). This SPEC instead uses the **external repo** model (like
Docs/Plainwrite), matching the `sovereign-wallet.local` repo already created
for this work. This is a deliberate deviation, not an oversight — Epic 21's
task descriptions in the platform repo should be reconciled with this
decision by a human before Epic 21 work actually starts there (flagged, not
silently changed in this pass).

## Current platform capability status (re-verified July 2026)

Re-checked against the running codebase, not just RFC status headers — RFC
"Draft" status does not always mean unimplemented; several SDK surfaces are
ahead of their RFC's paperwork.

| Capability | RFC | Status | Notes |
| --- | --- | --- | --- |
| `sdk.auth` | — | ✅ Stable | Session boundary. |
| `sdk.db` | — | ✅ Stable | Plugin-owned tables. |
| `sdk.secrets` | 0043 | ✅ Implemented | Real AES-256-GCM vault (`runtime/src/secrets.ts`); epic task 8.6 ✅. |
| `sdk.directory` | 0041 | ✅ Implemented | Member/share picker. |
| `sdk.data` | 0002 | ✅ Implemented | Cross-plugin read-only contracts. |
| `sdk.notifications` | 0015 | ✅ Implemented | In-app/push alerts. |
| `sdk.connections` | 0049 | ✅ Implemented | `packages/sdk/src/connections.ts` — real host-backed CRUD + OAuth state, despite RFC 0049 still reading "Draft". |
| `sdk.portability` (export/import/delete) | 0007 | ✅ Implemented | Epic 8.2 ✅; already supports `blobs` in export sections and a `DeletionHandler`. RFC 0052 ("Plugin portability hooks", still Draft, epic 8.8 still 📋) proposes richer hooks, but the existing surface already covers what both Wallet tracks need. |
| `sdk.storage` | 0044 | ❌ Stub | `packages/sdk/src/unimplemented.ts` — `put()`/`get()` throw `NotImplementedError`. Epic 8.7 still 📋. |
| Client-side encryption core (`sdk.crypto.client` / `sdk.e2ee`) | 0060 | ❌ Missing | Draft RFC only, no code. Epic 8.9 still 📋. |
| Plugin-scoped roles/grants | 0054 | ❌ Missing | Needed for future shared wallets / accountant access. |
| Public plugin webhooks | 0050 | ❌ Missing | Needed only for payment-provider callbacks (ledger v0.5), far downstream. |
| Public plugin page routes | 0042 | ❌ Missing | Neither track needs public routes in v1 — both are explicitly "no public UI". |
| Sovereign ID | — | ❌ Doesn't exist | Only a sibling, also-unbuilt external-plugin proposal (`local/sovereign-plugin-proposals/sovereign-id.md`). Needed only for ledger v0.3+. |

**Net effect:** the cards/documents track's centerpiece (encrypted document
snapshots, Epic 21.3) is hard-blocked on platform work that doesn't exist yet
(RFC 0060 + RFC 0044). The finance-ledger track's v0.1 has **no platform
blockers** — it can ship entirely on primitives that already work. See
[roadmap.md](roadmap.md) for the sequencing decision and why cards/documents
was still chosen as phase 1 despite the extra platform lift.

## Contents

- [Identity and manifest](#identity-and-manifest)
- [Scope boundaries](#scope-boundaries)
- [Access control](#access-control)
- [Functional requirements](#functional-requirements)
- [Cards & documents track — design](#cards--documents-track--design)
- [Finance ledger track — design](#finance-ledger-track--design)
- [Directory structure](#directory-structure)
- [Data model](#data-model)
- [SDK dependencies](#sdk-dependencies)
- [Security and privacy rules](#security-and-privacy-rules)
- [UI](#ui)
- [Build plan](#build-plan)
- [Open questions](#open-questions)
- [Changelog](#changelog)

---

## Identity and manifest

| Property                           | Value                                                      |
| ----------------------------------- | ----------------------------------------------------------- |
| `id`                                | `fs.sovereign.wallet`                                       |
| `name`                              | `Wallet`                                                     |
| `type`                              | `sovereign`                                                  |
| `runtime`                           | `native`                                                     |
| `routePrefix`                       | `/wallet`                                                    |
| `shell`                             | `default`                                                    |
| `adminOnly`                         | omitted (`false`)                                            |
| `icon`                              | `icon.svg`                                                   |
| `permissions`                       | `auth:session`, `db:readWrite`                                |
| `repository`                        | `https://github.com/sovereignfs/sovereign-plugin-wallet`             |
| `compatibility.minPlatformVersion`  | `0.19.0` (raised once RFC 0060 + RFC 0044 land — see roadmap) |

`id: fs.sovereign.wallet` replaces the original proposal's
`io.openfs.sovereign.wallet`, for consistency with Sovereign Docs'
`fs.sovereign.docs` namespace convention. This is a deliberate change from
the original proposal.

Proposed `manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.wallet",
  "name": "Wallet",
  "version": "0.1.0",
  "description": "A private wallet for loyalty cards, encrypted documents, and personal financial records.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/wallet",
  "shell": "default",
  "database": {
    "isolation": "isolated",
    "dialect": "sqlite"
  },
  "icon": "icon.svg",
  "permissions": ["auth:session", "db:readWrite"],
  "repository": "https://github.com/sovereignfs/sovereign-plugin-wallet",
  "compatibility": { "minPlatformVersion": "0.19.0" }
}
```

Future versions that add storage-backed attachments, provider tokens,
notifications, or public callbacks must add the matching permissions only
when those features ship.

## Scope boundaries

### In scope

- QR/barcode loyalty cards.
- Client-side encrypted sensitive-document snapshots (passport, ID).
- Personal wallet profile (finance track).
- Manual financial accounts, transactions, categories, counterparties.
- Balance calculation.
- CSV import/export.
- Future Sovereign-ID-linked wallet credentials.
- Future financial provider connections.
- Future payment intents and signed approvals.

### Out of scope

- Payment cards or payment processing (Apple/Google Wallet pass generation).
- Government ID verification.
- OCR/search of document contents.
- Sharing encrypted wallet items with other users.
- Operator escrow of recovery material.
- Moving money, payment execution, crypto custody, blockchain private keys.
- Bank aggregation / Open Banking sync.
- Card issuing, KYC, tax filing, investment tracking, credit/lending.
- Public payment links, merchant checkout.
- Shared/family wallets, accountant access (until RFC 0054 exists).
- Receipt/statement attachments (until `sdk.storage` exists).

## Access control

Wallet is available to authenticated users who can launch installed plugins.
No admin-only gate for personal wallet management.

- A user can create and view only their own wallet profile, cards, documents,
  accounts, and transactions.
- Every query must scope by `tenant_id` and current user ownership.
- Admins/operators must not get implicit access to user wallet records
  through the Wallet UI.
- Encrypted document snapshots are additionally protected by client-side
  encryption — even a compromised operator/runtime cannot read plaintext.

Future shared-wallet rules require plugin-scoped roles/grants (RFC 0054):
wallet owner, wallet member, read-only viewer, accountant/export-only role,
approval-only role for payment intents.

## Functional requirements

Requirements are versioned to their milestone. IDs are stable — never
renumber or reuse a `WLT-*` id. IDs below `WLT-30` are the cards/documents
track (from RFC 0061); `WLT-30`+ are the finance-ledger track (renumbered
from the original proposal's `WLT-01..36` to avoid collision).

### v0.1 — Cards & documents (Epic 21 scope)

| ID | Requirement |
| --- | --- |
| WLT-01 | Wallet home view with empty state and item categories (cards, documents). |
| WLT-02 | Create, view, edit, delete QR/barcode loyalty cards (display name, issuer, payload, format, notes). |
| WLT-03 | Browser-side QR/barcode rendering; no payload sent to an external service. |
| WLT-04 | Optional front/back card image, once `sdk.storage` exists. |
| WLT-05 | Locked-state UI path when a card payload is encrypted. |
| WLT-06 | Sensitive-document upload gated on client-side encryption setup being complete. |
| WLT-07 | Browser-side binary encryption of document images before upload; ciphertext via `sdk.storage`; plaintext bytes never reach the runtime. |
| WLT-08 | Human-readable document metadata (title, issuer, doc type, country, number, filename, notes) stored encrypted. |
| WLT-09 | Browser-side decrypt-and-display flow using Blob URLs. |
| WLT-10 | Locked/recovery UX explaining data-loss implications before upload. |
| WLT-11 | Export hook: encrypted metadata, wrapped keys, ciphertext storage objects. |
| WLT-12 | Import hook: remaps object IDs, preserves encrypted payloads. |
| WLT-13 | Delete hook: removes wallet rows, wrapped keys, storage objects, idempotently. |

### v0.2 — Finance ledger POC (private ledger)

| ID | Requirement |
| --- | --- |
| WLT-30 | Create a wallet profile for the current authenticated user. |
| WLT-31 | Add manual accounts with name, type, currency, opening balance, and status. |
| WLT-32 | Supported account types: cash, bank placeholder, card placeholder, digital wallet, other. |
| WLT-33 | Edit, archive, and delete manual accounts after confirmation. |
| WLT-34 | Add manual transactions with date, amount, direction, account, category, counterparty, notes. |
| WLT-35 | Supported transaction types: income, expense, transfer, adjustment. |
| WLT-36 | Validate transfers as paired movements between two user-owned accounts. |
| WLT-37 | Calculate account balances from opening balance plus posted transactions. |
| WLT-38 | Add, rename, merge, archive, delete categories. |
| WLT-39 | Add and reuse counterparties/payees. |
| WLT-40 | Filter/search transactions by account, date, category, counterparty, amount, text. |
| WLT-41 | Import transactions from CSV with user-reviewed column mapping. |
| WLT-42 | Export accounts, categories, counterparties, transactions as CSV. |
| WLT-43 | Wallet summary: totals by account type, recent activity, monthly income/expense. |

### v0.3 — Ledger financial organization

| ID | Requirement |
| --- | --- |
| WLT-44 | Add budgets by category and month. |
| WLT-45 | Add recurring transactions. |
| WLT-46 | Add transaction reconciliation status: pending, posted, reviewed, reconciled. |
| WLT-47 | Add statement import batches and duplicate detection. |
| WLT-48 | Add audit events for import, export, account changes, transaction deletion, reconciliation. |
| WLT-49 | Add receipt/statement attachments, once `sdk.storage` exists. |

### v0.4 — Ledger Sovereign ID integration

Requires the (separate, unbuilt) Sovereign ID plugin to expose a stable
identity, credential, and signing interface.

| ID | Requirement |
| --- | --- |
| WLT-50 | Link a wallet profile to a Sovereign ID after explicit user approval. |
| WLT-51 | Issue a wallet-readiness credential or local signed claim. |
| WLT-52 | Sign wallet-sensitive actions through Sovereign ID where available. |
| WLT-53 | Add consent screens before sharing wallet credentials or financial claims. |
| WLT-54 | Record signed approval artifacts for sensitive wallet operations. |

### v0.5 — Ledger external financial connections

Requires provider secrets (`sdk.secrets`, ready) and `sdk.connections`
(ready).

| ID | Requirement |
| --- | --- |
| WLT-55 | Add external provider connection records. |
| WLT-56 | Store provider tokens/secrets only through the plugin secret vault. |
| WLT-57 | Sync accounts and balances from approved providers. |
| WLT-58 | Sync transactions from approved providers with duplicate detection and import review. |
| WLT-59 | Let users revoke provider connections and delete provider-sourced data per policy. |

### v0.6 — Ledger payment intents and approvals

Requires Sovereign ID signing, audit events, and provider callback/webhook
support (RFC 0050) where needed.

| ID | Requirement |
| --- | --- |
| WLT-60 | Create payment intents without executing payment automatically. |
| WLT-61 | Show payment details, recipient, amount, provider, fees, risk warnings before approval. |
| WLT-62 | Approve or reject payment intents with explicit user confirmation. |
| WLT-63 | Store signed approval/rejection records. |
| WLT-64 | Hand approved intents to a configured payment provider. |
| WLT-65 | Track payment status from provider callbacks or polling. |

## Cards & documents track — design

**Data classes:**

| Class | Examples | Storage default |
| --- | --- | --- |
| Loyalty card | QR code, barcode, membership ID | private record; encryption recommended |
| Sensitive document | passport photo, ID photo, permit | client-side encrypted object required |

**Sensitive document flow:**

```text
Browser selects image
  -> optional client-side normalization/compression
  -> encrypt binary bytes with per-object DEK
  -> upload ciphertext through sdk.storage
  -> store encrypted metadata and wrapped DEK references
```

Display flow:

```text
User opens Wallet
  -> Wallet sees encrypted item
  -> user unlocks client-side encryption profile
  -> plugin downloads ciphertext
  -> browser decrypts bytes
  -> browser renders Blob URL in <img>
```

No decrypted image is ever sent back to the runtime.

**Metadata minimization** — plaintext: item ID, owner user ID, timestamps,
storage object key, encryption version, optional coarse `kind_hint` (`card`
vs `document`). Encrypted: title, issuer, document type, country,
document/card number, original filename, notes, thumbnail metadata.

**Recovery UX** — Wallet must explain that encrypted documents cannot be
recovered after password reset unless the user has a recovery secret or
another enrolled device. Sensitive-document upload is blocked until
client-side encryption setup is complete.

## Finance ledger track — design

**Product thesis** — separate local financial control from actual money
movement:

```text
Sovereign ID = identity, consent, credentials, signing authority
Wallet (ledger track) = accounts, balances, transactions, credentials, approvals
```

**Payment approval model** (v0.6, future) — payment execution is out of
scope until then. When it lands:

```text
Create payment intent
  -> show exact amount, recipient, provider, fees, and risk context
  -> user approves or rejects
  -> Wallet records signed approval/rejection
  -> approved intent is handed to provider
  -> status is tracked from provider
```

Wallet must never silently execute money movement because another plugin,
assistant, automation, or external provider requested it.

**External connection rules** (v0.5, future):
- no provider connection enabled by default;
- each provider must show requested permissions before connection;
- provider tokens live in `sdk.secrets`, never in normal DB columns;
- users can disconnect providers;
- imported provider data must be distinguishable from manual data;
- destructive provider-disconnect behavior must be explicit.

## Directory structure

```text
sovereign-wallet/
├── manifest.json
├── icon.svg
├── app/
│   ├── page.tsx                    # wallet home (cards + documents)
│   ├── cards/page.tsx
│   ├── cards/[cardId]/page.tsx
│   ├── documents/page.tsx
│   ├── documents/[documentId]/page.tsx
│   ├── ledger/page.tsx             # finance dashboard
│   ├── ledger/accounts/page.tsx
│   ├── ledger/accounts/[accountId]/page.tsx
│   ├── ledger/transactions/page.tsx
│   ├── ledger/import/page.tsx
│   ├── ledger/export/page.tsx
│   ├── ledger/categories/page.tsx
│   ├── ledger/connections/page.tsx # future external providers
│   ├── ledger/approvals/page.tsx   # future payment approvals
│   └── _components/
├── db/
│   └── schema.ts
├── migrations/
├── lib/
│   ├── crypto.ts                   # client-side encrypt/decrypt helpers (consumes sdk.crypto.client)
│   ├── qr.ts
│   ├── balances.ts
│   ├── csv.ts
│   ├── transfers.ts
│   ├── reconciliation.ts
│   └── approvals.ts
└── package.json
```

No public routes are required in this SPEC's scope.

## Data model

All tables `wallet_`-prefixed, all carry `tenant_id` (platform rule).

### Cards & documents track

#### `wallet_items`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `owner_user_id` | string | |
| `kind` | enum | `card`, `document`. |
| `kind_hint` | string? | Coarse plaintext navigation hint only. |
| `storage_object_key` | string? | Encrypted binary object reference (`sdk.storage`). |
| `encryption_version` | string? | Algorithm/version metadata for encrypted items. |
| `encrypted_metadata` | text? | Encrypted JSON blob: title, issuer, doc type, country, number, filename, notes. |
| `wrapped_dek` | text? | Wrapped per-object data encryption key. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_card_payloads`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `item_id` | uuid / fk | References `wallet_items` where `kind = card`. |
| `owner_user_id` | string | |
| `barcode_format` | string? | e.g. `qr`, `code128`. |
| `payload_encrypted` | boolean | Whether payload is client-side encrypted. |
| `payload` | text | Encrypted or plaintext depending on `payload_encrypted`. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### Finance ledger track

#### `wallet_profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `owner_user_id` | string | Current Sovereign user. |
| `display_name` | string? | Private label. |
| `base_currency` | string | ISO currency code, e.g. `USD`, `EUR`, `LKR`. |
| `sovereign_id` | string? | Future linked Sovereign ID DID. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_accounts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | Denormalized for owner scoping. |
| `name` | string | |
| `type` | enum | `cash`, `bank`, `card`, `digital_wallet`, `other`. |
| `currency` | string | ISO currency code. |
| `opening_balance` | decimal | |
| `status` | enum | `active`, `archived`, `closed`. |
| `external_ref` | string? | Future provider account reference; never secret material. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | |
| `name` | string | |
| `type` | enum | `income`, `expense`, `neutral`. |
| `parent_id` | uuid? | Optional category nesting. |
| `status` | enum | `active`, `archived`. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_counterparties`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | |
| `name` | string | Merchant, person, or payee. |
| `notes` | text? | |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_transactions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | |
| `account_id` | uuid / fk | |
| `category_id` | uuid? | |
| `counterparty_id` | uuid? | |
| `transfer_group_id` | uuid? | Links paired transfer transactions. |
| `type` | enum | `income`, `expense`, `transfer`, `adjustment`. |
| `status` | enum | `pending`, `posted`, `reviewed`, `reconciled`, `void`. |
| `transaction_date` | date | |
| `amount` | decimal | Positive decimal; direction derived from `type`. |
| `currency` | string | ISO currency code. |
| `description` | string? | |
| `notes` | text? | |
| `source` | enum | `manual`, `csv_import`, `provider_sync`, `payment`. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_import_batches`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | |
| `source` | enum | `csv`, `provider`. |
| `file_name` | string? | |
| `mapping` | json | User-approved column/provider mapping. |
| `status` | enum | `pending`, `imported`, `failed`, `void`. |
| `created_at` | timestamp | |
| `completed_at` | timestamp? | |

#### `wallet_payment_intents` (future, v0.6)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | |
| `provider` | string | Payment provider identifier. |
| `recipient` | json | Recipient/payee details. |
| `amount` | decimal | |
| `currency` | string | |
| `status` | enum | `draft`, `pending_approval`, `approved`, `rejected`, `submitted`, `settled`, `failed`. |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

#### `wallet_approvals` (future, v0.6)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid / pk | |
| `tenant_id` | string | |
| `profile_id` | uuid / fk | |
| `owner_user_id` | string | |
| `subject_type` | string | Example: `payment_intent`. |
| `subject_id` | uuid | |
| `decision` | enum | `approved`, `rejected`. |
| `signed_artifact` | text? | Future Sovereign ID signed approval. |
| `created_at` | timestamp | |

## SDK dependencies

| SDK surface | Used for | Status |
| --- | --- | --- |
| `sdk.auth` | Current user/session | Stable |
| `sdk.db` | `wallet_*` tables | Stable |
| `sdk.storage` | Encrypted document ciphertext, card images, receipts | ❌ Stub — blocks WLT-04, WLT-07, WLT-49 |
| `sdk.crypto.client` / `sdk.e2ee` | Client-side encryption for documents | ❌ Missing — blocks WLT-06 through WLT-13 |
| `sdk.portability` | Export/import/delete hooks | ✅ Implemented — ready for WLT-11/12/13 |
| `sdk.secrets` | Provider tokens, payment credentials | ✅ Implemented — ready for WLT-56 |
| `sdk.connections` | External provider connection records | ✅ Implemented — ready for WLT-55, WLT-57, WLT-58 |
| `sdk.directory` | Not currently used (no sharing in scope) | ✅ Implemented, unused for now |
| `sdk.notifications` | Future payment/reconciliation alerts | ✅ Implemented |
| Sovereign ID SDK/contracts | Identity, consent, signing, credential presentation | ❌ Doesn't exist — blocks WLT-50 through WLT-65 |

The plugin must not import from platform runtime internals.

## Security and privacy rules

- Wallet data is private by default; no public routes.
- No external provider sync, no money movement, no crypto custody in the
  current SPEC scope.
- Admin/operator users do not get implicit access to personal wallet records.
- Every query must scope by `tenant_id` and current user ownership.
- Provider tokens and payment credentials must never be stored in normal
  database columns — only through `sdk.secrets`.
- Sensitive document bytes and their human-readable metadata must be
  client-side encrypted; the server stores no plaintext image, no plaintext
  original filename, no plaintext human-readable document metadata unless
  the user explicitly chooses a non-sensitive hint.
- Payment approvals (future) must be explicit, reviewable, auditable, and
  signed through Sovereign ID where available.
- Imports, exports, provider connections, payment approvals, destructive
  edits, and deletions require audit events.
- Deleting a user or wallet profile must participate in platform data rights
  and plugin portability/deletion hooks.
- The UI must avoid implying bank custody, legal identity, insured accounts,
  payment execution, or investment advice unless those capabilities actually
  exist.

## UI

**Cards & documents:**
- **Wallet home** — cards + documents, empty state, category tiles.
- **Card detail** — QR/barcode render, locked-state path.
- **Document detail** — decrypt-and-display flow, recovery warnings.

**Finance ledger:**
- **Dashboard** — account balances, recent activity, monthly income/expense,
  import/export actions.
- **Accounts** — manual account list, account detail, balance, transaction
  history.
- **Transactions** — searchable/filterable ledger.
- **Categories** — category management.
- **Counterparties** — merchant/payee list.
- **Import / Export** — CSV upload/mapping/review; CSV export controls.

**Future views:** Budgets, Reconciliation, Connections, Credentials,
Approvals, Payment intents.

No public-facing UI ships in this SPEC's scope.

## Build plan

See [roadmap.md](roadmap.md) for the dependency-ordered, per-task build plan.
Summary of sequencing:

1. **Platform prerequisite** — RFC 0060 (client-side encryption core) and
   RFC 0044 (`sdk.storage`) must land in `claude-sv` before encrypted
   documents can ship.
2. **Cards & documents v0.1** (Epic 21 scope) — chosen as this plugin's
   phase-1 deliverable, per explicit priority decision.
3. **Finance ledger v0.2 (POC)** — no platform blockers, can run in parallel
   with phase 1/2 platform work if desired.
4. **Ledger v0.3 (organization/audit)**, gated on `sdk.storage`.
5. **Ledger v0.4 (Sovereign ID)**, gated on the separate, unbuilt Sovereign
   ID plugin.
6. **Ledger v0.5 (external connections)**, ready today (SDK-wise) once
   reached in sequence.
7. **Ledger v0.6 (payment intents/approvals)**, gated on Sovereign ID + RFC
   0050.

## Open questions

1. Should the ledger track support multiple currencies per wallet profile,
   or one base currency plus per-account currencies?
2. What decimal precision policy should be used for money values?
3. Should transaction amounts be stored in minor units, decimals, or both?
4. Should categories be global defaults copied per user, or user-created
   only?
5. Should CSV import store original row data for audit/debugging?
6. What is the first Sovereign ID credential Wallet needs?
7. Should payment intents live in Wallet, or should a future
   Checkout/Payments plugin own provider execution while Wallet owns
   approval records?
8. What regulatory/compliance disclaimer should the product carry before any
   provider/payment work begins?
9. Should cards/documents and the finance ledger eventually split into two
   plugins if the access models diverge (e.g. ledger gains shared/family
   wallets via RFC 0054 while documents stay strictly single-owner)?
10. ✅ Resolved (W-11) — opt-in per card, not encrypted by default. Matches
    this SPEC's own data-class table above ("encryption recommended", not
    required, for loyalty cards — unlike sensitive documents). The "Add card"
    dialog offers an "Encrypt this card" checkbox, enabled only once the user
    has set up client-side encryption (RFC 0060) and unlocked it on this
    device; an encrypted card's title/issuer/notes/payload are stored as
    ciphertext only and decrypted client-side on view (locked-state
    placeholder otherwise) — never sent to or reconstructed by the server.
11. ✅ Resolved (W-10) — `qrcode` for QR codes, `jsbarcode` for 1D formats
    (Code 128, Code 39, EAN-13, UPC). Both render entirely client-side
    (canvas/SVG); no payload is ever sent to an external service. `other` has
    no renderer — the raw payload text is shown instead.
12. Is client-side image compression in phase 1?
13. Does a mobile-optimized scan/import flow wait for the native mobile app?
14. Should Wallet support a plaintext emergency export mode for documents,
    and how would it warn users?

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | June 2026 | Two independent drafts: finance-ledger proposal and RFC 0061 (cards/documents). |
| 0.2 | July 2026 | Merged into a single SPEC; `id` changed to `fs.sovereign.wallet`; repo model set to external, deviating from RFC 0061's in-monorepo framing; requirement IDs renumbered into one `WLT-*` sequence; platform capability status re-verified against code. |
