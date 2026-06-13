# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### In progress
- Online payment (Paystack) checkout: bank transfer / card-less / new-customer
  flow. The order is created unpaid and a hosted `pay_for_me` link reaches
  Paystack, but full programmatic completion is not yet wired.

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
