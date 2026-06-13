# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### In progress
- Online payment (Paystack) checkout: bank transfer / card-less / new-customer
  flow. The order is created unpaid and a hosted `pay_for_me` link reaches
  Paystack, but full programmatic completion is not yet wired.

## [0.6.0] — 2026-06-13

### Added
- **`get_menu` category filter** — optional `category` parameter filters menu
  items by category name (case-insensitive partial match). Prevents response
  truncation on large menus (e.g. 133 items at Labule) where items in smaller
  categories like "Small Chops" were cut off.

### Changed
- `get_menu` without `category` still returns the full menu (backwards compatible).

## [0.5.1] — 2026-06-13

### Changed
- **Published to npm as the scoped package `@thathman/chowdeck-mcp`** (`publishConfig.access: public`).
- Description now leads with **"Unofficial … Not affiliated with Chowdeck."**
- `prepack` copies `README.md` + `LICENSE` into the package so they ship in the
  npm tarball (the package root is `mcp/`).
- README `npx` instructions updated to the scoped name.

## [0.5.0] — 2026-06-13

### Added
- **MCP prompts** — pickable, reusable flows that drive the tools while keeping
  the SKILL's safety rules (confirm address + total before ordering):
  `order_food`, `find_food_near_me`, `track_my_order`, `reorder_my_usual`.

## [0.4.0] — 2026-06-13

### Added
- **`track_order`** — compact live status (status, ETA, delivery PIN, rider
  name/phone, payment status, tracking link) for following a delivery.
- **Scheduled delivery & tipping** — `place_order` accepts `scheduled_for`
  (ISO 8601) and `rider_tip` (NGN); both surface in the confirmation prompt.
- **`validate_promo`** — check a promo/voucher code before checkout; valid codes
  go to `place_order` via `promo_codes`.
- **`wallet_topup`** — initialise a wallet top-up (returns a Paystack link);
  destructive + confirmation-gated.

> Note: scheduled-delivery / tip fields and the promo & wallet-topup endpoints
> are best-effort (inferred) and may need adjustment against the live API.

## [0.3.0] — 2026-06-13

### Added
- **Discovery filters** on `list_vendors` (sort, open_now, min_rating,
  max_delivery_fee, free_delivery, page) and `search` (sort, open_now,
  min_rating).
- **Favourites** — `list_favorites`, `add_favorite`, `remove_favorite` for saved
  vendors.
- **`reorder`** — rebuild a cart from a past order id, ready to confirm and
  check out.

> Note: favourites endpoints are best-effort (inferred paths) and may need
> adjustment against the live API.

## [0.2.0] — 2026-06-13

### Added
- **Tool annotations** — every tool is now hinted `readOnlyHint` or
  `destructiveHint` so hosts can gate the dangerous ones.
- **Confirmation gate** on destructive / money-moving tools (`place_order`,
  `clear_carts`, `delete_cart`, `logout`). They stay callable but only execute
  with `confirm: true`, which the agent should set only after the user approves;
  otherwise they return a "confirm first" no-op.
- **Structured output** (`outputSchema` + `structuredContent`) on `get_session`
  and `get_setup_status` for machine-readable results.

### Changed
- Migrated all 38 tools to the modern `registerTool` API.
- **Response slimming** — discovery/list/menu responses are recursively trimmed
  (heavy media keys dropped, long strings truncated, arrays capped at 60) to cut
  token usage without losing the fields agents reason over.
- `update_cart` quantities are validated (`1..99`, integer).

## [0.1.2] — 2026-06-13

### Changed
- **License changed from CC-BY-4.0 to MIT** — Creative Commons is not intended
  for software; MIT is the right fit for a code library. `LICENSE`, badges, and
  source headers updated.

### Fixed
- **CLI shebang** — `dist/index.js` now starts with `#!/usr/bin/env node` and is
  marked executable, so `npx chowdeck-mcp` / the `bin` entry actually runs.
- Corrected the author contact email typo (`airixmmedia` → `airixmedia`).

### Added
- `engines.node >= 18` in `package.json`.

## [0.1.1] — 2026-06-13

### Security
- **Session file hardened** — `~/.chowdeck-mcp/session.json` (holds the bearer
  token) is now written with `0600` perms inside a `0700` directory.
- **No third-party keys embedded** — the Google Maps key is read from
  `CHOWDECK_MAPS_KEY`; reverse-geocoding errors clearly if it's unset. The
  previously embedded key was purged from git history.
- **Unofficial / unaffiliated disclaimer** added to the README, emphasising
  self-authentication, ToS respect, and no bundled credentials.

### Changed
- HTTP client now sets a request **timeout** (`CHOWDECK_TIMEOUT_MS`, default 15s)
  and **retries only transient failures** (network / 5xx) with bounded backoff
  (`CHOWDECK_MAX_RETRIES`); order placement opts out to avoid duplicate orders.
- `ip-api` IP-location lookup moved to an **HTTPS** provider.
- Phone numbers are **validated** (11-digit Nigerian format) before any OTP is
  sent.
- Base URL and app version are configurable via `CHOWDECK_API_BASE` /
  `CHOWDECK_APP_VERSION`.

## [0.1.0] — 2026-06-11

### Added
- Initial MCP server for Chowdeck with 38 tools across:
  - **Setup & session** — persistent login + delivery address, new-vs-returning
    detection, payment preference.
  - **Location** — address search, place details, reverse geocode, set address
    from a resolved place.
  - **Discovery** — config, vendors, featured vendors, search, menus, menu items.
  - **Cart** — create/update, list, per-vendor, clear, delete.
  - **Auth** — phone OTP login, profile.
  - **Account** — saved addresses, wallet, order history, payment methods.
  - **Orders** — place order, active orders, order detail, delivery fee quote,
    payment channels, payment start, verify payment.
- Disk-persisted session (`~/.chowdeck-mcp/session.json`).
- CI workflow, CC BY 4.0 license, author watermark.

### Status
- ✅ **Stable:** returning customers paying with a **saved card** — order is
  placed and charged inline, with delivery PIN and rider details.
- 🚧 **In progress:** online payment / bank transfer for card-less and new
  customers.
