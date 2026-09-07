# Wallet

Wallet is a Sovereign plugin for a private wallet: QR/barcode loyalty cards,
client-side encrypted sensitive-document snapshots, and a manual personal
finance ledger. Full requirements: [SPEC.md](SPEC.md). Build sequencing:
[roadmap.md](roadmap.md).

## Local development

To test this standalone checkout against the platform, clone or copy it into
a platform workspace as a plugin checkout:

```bash
plugins/sovereign-wallet
```

Then run the platform generate/dev workflow from the platform repository:

```bash
pnpm generate
pnpm dev
```

The app is served at `/wallet` once composed by the platform.

## Current scope

**Cards & documents (v0.1) is implemented** — roadmap tasks W-00 through
W-17. That covers loyalty-card CRUD with browser-side QR/barcode rendering,
optional per-card client-side encryption, encrypted front/back card images,
always-encrypted sensitive documents with a decrypt-and-display flow, and
export/import/delete through `sdk.portability`. The platform prerequisites it
was once blocked on — `sdk.storage` (RFC 0044) and the client-side encryption
core (RFC 0060) — have both shipped.

Not yet started: the mobile device-capability primitives (W-54/W-55, blocked
on `sdk.device.*`) and the finance-ledger track (v0.2 onward, W-18+), which
has no platform blockers. See [roadmap.md](roadmap.md) for phase sequencing.

## Identity

| Property     | Value                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Plugin ID    | `fs.sovereign.wallet`                                                                                  |
| Route prefix | `/wallet`                                                                                              |
| Permissions  | `auth:session`, `db:readWrite`, `e2ee:use`, `storage:readWrite`, `data:export`, `data:import`           |
| Min platform | `0.24.0`                                                                                               |
| Table prefix | `wallet_`                                                                                              |
| Database     | Dedicated store, isolated. The dialect follows the instance's own `DB_DIALECT` — a dedicated sqld namespace on SQLite, a `plugin_fs_sovereign_wallet` schema on Postgres. There is no per-plugin dialect choice and no `database` key in the manifest; see `docs/plugin-database.md` in the platform repo. |

## Testing

From the **platform** repo root (the plugin has no test runner of its own):

```bash
pnpm vitest run plugins/sovereign-plugin-wallet.local
```
