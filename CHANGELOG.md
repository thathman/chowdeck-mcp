# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### In progress
- Online payment (Paystack) checkout: bank transfer / card-less / new-customer
  flow. The order is created unpaid and a hosted `pay_for_me` link reaches
  Paystack, but full programmatic completion is not yet wired.

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
