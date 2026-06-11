---
name: chowdeck
description: Order food and groceries on Chowdeck (Nigeria). Discover vendors and meals, build a cart, place and track orders. Use when the user wants to find food near them, order a meal, check restaurant menus, or track a Chowdeck delivery. Handles a one-time login (phone + OTP) and saved delivery address.
---

# Chowdeck

Order food, groceries, and pharmacy items on Chowdeck via its `api.chowdeck.com` backend. Backed by the `chowdeck` MCP server (tools listed below). All money is in NGN; Chowdeck operates in Nigeria.

## What the agent needs (be upfront)

Tell the user at the start what setup requires:
- **A Nigerian phone number + the OTP** sent to it (one-time login).
- **A delivery location** (current GPS, or an address you'll search and confirm).
- **Optionally a payment method** — returning users usually already have one (card/wallet); new users can pay per order once a method is added in the Chowdeck app.

## First-time setup (run once)

**Always call `get_setup_status` first.** It tells you everything: `authenticated`, `address_id`, `payment_pref`, `setup_complete`, and (once logged in) `user_type` = `new` | `returning` plus `address_count`, `saved_payment_count`, `wallet`, `order_count`, and a `next` hint. If `setup_complete` is `true`, skip setup — state persists across restarts on disk (`~/.chowdeck-mcp/session.json`).

Setup flow: log in, then branch on whether the account is new or returning. Collect details conversationally — never invent a phone number, OTP, address, or coordinates.

### 1. Login (phone + OTP)

1. Ask the user for their Nigerian phone number.
2. Call `login_send_otp` with the phone. Tell the user an OTP was sent via SMS/WhatsApp.
3. Ask the user to paste the OTP code they received.
4. Call `login_verify_otp` with the phone and OTP. On success the bearer token is saved automatically.
   - If it fails (wrong/expired code), tell the user and offer to resend via `login_send_otp`.

### 2. Branch on user type

After login, read `get_setup_status` again — it now reports `user_type`.

**Returning user** (`user_type: "returning"` — has saved addresses, payment, or past orders):
1. Summarize what's on the account: "You have N saved addresses, a saved card/wallet, ₦X wallet balance." Use `list_addresses`, `get_payment_methods`, `get_wallet`.
2. **Default the address** to the account's active one via `get_active_address`. Read it back and let the user switch (search flow below) — don't silently assume.
3. **Payment preference (one time).** If `payment_pref` is null, ask the user once: *"Use a default payment method automatically, or confirm payment each order?"* Save it with `set_payment_pref(mode, method_id?, method_label?)`. `mode:"default"` skips method-selection later; `mode:"ask"` lists methods every order.

**New user** (`user_type: "new"` — empty account):
1. Resolve a delivery address (search flow below) — this is required, there's nothing saved.
2. Explain payment will be confirmed each order until they add a method in the Chowdeck app. Leave `payment_pref` unset (treated as `ask`).

### Resolving a delivery address (exact coordinates required)

This is a delivery service — the address **must be exact**. Never invent or guess coordinates.
1. **Suggest current location.** If the host can provide device GPS, call `reverse_geocode(latitude, longitude)` and offer the top candidate. Otherwise `suggest_current_location` gives a rough city (IP-based — approximate, never delivery-accurate) to seed the search only.
2. **Search and let the user pick.** `search_places(input)` → show predictions (`description` + `place_id`); the user chooses. Don't auto-pick when several plausibly match.
3. **Save the exact place.** `set_address_from_place(place_id, house_no?)` resolves precise coordinates via `place_details` and saves. Avoid `set_address` with hand-typed coordinates except as a last resort.
4. **Read back and confirm** the saved `pretty_name` before continuing.

Once a token and a confirmed address_id exist, setup is complete and persists. Confirm: "You're set up — logged in as <phone>, delivering to <address>."

### Order-time confirmation (every order)

Before `place_order`, always:
1. **Re-confirm the delivery address** — read it back (`get_active_address` / `get_session`) and show exactly where it's going. Let the user switch (re-run the address-resolution flow). Never place against an unconfirmed address.
2. **Apply the payment preference** — if `payment_pref.mode` is `"default"`, use the saved method; if `"ask"` (or unset), list `get_payment_methods` and have the user pick.
3. **Confirm the full order** — items, vendor, delivery fee, and total. Even in `default` payment mode, the total and address are always confirmed; "default" only removes method-selection, not the final go-ahead.

## Everyday flows

**Find food / suggest meals**
- `featured_vendors` (tag `featured` | `handpicked` | `explore`) for curated picks.
- `list_vendors` (optional `vendor_type`, `tag`, `q`) for browsing near the address.
- `search` with a query for a specific dish or restaurant.
- `get_menu` / `get_menu_categories` / `get_menu_item` to inspect a vendor's offerings (prices, options, add-ons, stock).

**Build a cart**
- `update_cart` with `vendor_id` and `items` (`item_id`, `quantity`). Works even before login (guest cart); after login the guest cart is upgraded automatically.
- `get_carts` / `get_vendor_cart` to review.

**Paying without a saved card (new / card-less customers)**
- Saved card: `place_order` with `payment_method: "card"` + `payment_method_id` charges inline (response `made_payment: true`).
- No saved card / wants bank transfer: `place_order` with `payment_method: "pay_for_me"`. The response includes `pay_for_me_url` — a Chowdeck-hosted payment page (expires ~1 hour). Give that link to the user (or drive it in a browser). On it: **Make Payment → choose Card / Bank Transfer / Opay / USSD / QR / etc → Make payment** opens Paystack to complete (e.g. a bank-transfer account number). The order stays unpaid until paid there.
- Note: the raw `start_order_payment` / `/order/{id}/payment` API does not reliably mint a Paystack link ("Unable to process payment link"); use the `pay_for_me_url` route instead. Unpaid orders auto-expire.

**Quote, place, track**
- `get_delivery_fee` to quote delivery for a vendor — gives the `fee_id` needed for checkout.
- `get_payment_methods` to see saved payment options (requires login).
- `place_order` to check out (requires login). **STABLE** for returning customers paying with a saved card (`payment_method: "card"` + `payment_method_id`) — charges inline. Online payment is **in progress** (see card-less section above). Always confirm the order summary and total before calling; surface any error verbatim.
- **After placing, always announce:** the order summary (vendor, items, total), the **delivery PIN** (`delivery_pin` from the `place_order` response — the customer gives it to the rider), and the **rider info** (`driver.rider_name` + `driver.phone` from `get_order`, once assigned). Include the `tracking_url`.
- `get_active_orders` / `get_order` to track. `verify_payment` to confirm a transaction.

## Rules

- Call `get_setup_status` before anything else each conversation.
- Confirm the full order (items, vendor, delivery fee, total) with the user before `place_order`. Never place an order the user didn't approve.
- Treat OTP and token as secrets — don't echo them back in summaries.
- After every placed order, announce the order summary, delivery PIN, and rider info.
- `logout` clears the saved session if the user wants to switch accounts.

## Setup (MCP server)

```bash
cd mcp && npm install && npm run build
claude mcp add chowdeck -- node <abs-path>/mcp/dist/index.js
```
