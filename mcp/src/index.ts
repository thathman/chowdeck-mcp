#!/usr/bin/env node
/*!
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Chowdeck MCP — Model Context Protocol server for Chowdeck food delivery    │
 * │                                                                            │
 * │  Author : Hendrix Nwaokolo  (@thathman)                                    │
 * │  Contact: hello@airixmedia.com                                             │
 * │  Source : https://github.com/thathman/chowdeck-mcp                         │
 * │  License: MIT — see LICENSE.                                                │
 * │                                                                            │
 * │  © 2026 Hendrix Nwaokolo.  Unofficial; not affiliated with Chowdeck.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as api from "./api.js";
import { session, clearSession } from "./session.js";

const server = new McpServer({ name: "chowdeck", version: "0.5.1" });

// ── Result helpers ──────────────────────────────────────────────────────────

function res(data: unknown): { content: { type: "text"; text: string }[]; structuredContent?: any } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * Recursively drop bulky/irrelevant fields and cap array sizes so large API
 * responses (menus, vendor lists) don't flood the model context. Shape-agnostic
 * and lossless for the fields an agent actually reasons over.
 */
const HEAVY_KEYS = new Set([
  "image", "images", "image_url", "banner", "banner_url", "photo", "photos",
  "thumbnail", "cover", "cover_image", "logo", "icon", "media", "html",
]);
function slim(value: any, depth = 0): any {
  if (Array.isArray(value)) {
    return value.slice(0, 60).map((v) => slim(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (HEAVY_KEYS.has(k)) continue;
      if (typeof v === "string" && v.length > 400) {
        out[k] = v.slice(0, 400) + "…";
      } else {
        out[k] = slim(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

async function run(fn: () => Promise<unknown>, opts: { slim?: boolean } = {}) {
  try {
    const data = await fn();
    return res(opts.slim ? slim(data) : data);
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message ?? String(err);
    return { ...res({ error: detail }), isError: true };
  }
}

/**
 * Confirmation gate for destructive / money-moving tools. They remain fully
 * callable by the agent, but only execute once `confirm:true` is passed — which
 * the agent should set ONLY after the user has explicitly approved.
 */
const CONFIRM = {
  confirm: z
    .boolean()
    .default(false)
    .describe("Set true ONLY after the user has explicitly approved this action. Without it, the call is a no-op that asks you to confirm first."),
};
function needConfirm(action: string) {
  return res({
    needs_confirmation: true,
    message: `This will ${action}. Confirm the details with the user first, then call again with confirm: true.`,
  });
}

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

// ── Session / address ─────────────────────────────────────────────────────────

server.registerTool(
  "set_address",
  {
    description: "Create a delivery address (works as guest). Stores the address id for later calls.",
    inputSchema: {
      street: z.string(),
      pretty_name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      city: z.string(),
      state: z.string(),
      country: z.string().default("Nigeria"),
      house_no: z.string().optional(),
      area: z.string().optional(),
    },
    annotations: WRITE,
  },
  async (args) => run(() => api.createAddress(args)),
);

server.registerTool(
  "get_session",
  {
    description: "Show current session state. Call this FIRST: if setup_complete is false, run the first-time setup flow (login + address).",
    inputSchema: {},
    outputSchema: {
      authenticated: z.boolean(),
      phone: z.string().nullable().optional(),
      guest_id: z.string().nullable().optional(),
      address_id: z.number().nullable().optional(),
      payment_pref: z.any().optional(),
      setup_complete: z.boolean(),
    },
    annotations: READ,
  },
  async () => {
    const data = {
      authenticated: !!session.token,
      phone: session.phone,
      guest_id: session.guestId,
      address_id: session.addressId,
      payment_pref: session.paymentPref,
      setup_complete: !!session.token && !!session.addressId,
    };
    return { ...res(data), structuredContent: data };
  },
);

server.registerTool(
  "logout",
  {
    description: "Clear the saved session (token, address, guest id) from disk. Requires confirm:true.",
    inputSchema: { ...CONFIRM },
    annotations: DESTRUCTIVE,
  },
  async ({ confirm }) => {
    if (!confirm) return needConfirm("log out and erase the saved session (you'll need to log in again)");
    clearSession();
    return res({ ok: true });
  },
);

// ── Location / geocoding ───────────────────────────────────────────────────────

server.registerTool(
  "search_places",
  {
    description: "Search delivery addresses by text (Chowdeck place autocomplete). Returns predictions with place_id and description. Show these to the user and let THEM pick the correct one.",
    inputSchema: { input: z.string() },
    annotations: READ,
  },
  async ({ input }) => run(() => api.searchPlaces(input)),
);

server.registerTool(
  "place_details",
  {
    description: "Get the exact coordinates and formatted address for a place_id from search_places.",
    inputSchema: { place_id: z.string() },
    annotations: READ,
  },
  async ({ place_id }) => run(() => api.placeDetails(place_id)),
);

server.registerTool(
  "reverse_geocode",
  {
    description: "Turn precise device coordinates (lat/lng) into address candidates. Needs CHOWDECK_MAPS_KEY. Use when the host can provide the user's current GPS location.",
    inputSchema: { latitude: z.number(), longitude: z.number() },
    annotations: READ,
  },
  async ({ latitude, longitude }) => run(() => api.reverseGeocode(latitude, longitude)),
);

server.registerTool(
  "suggest_current_location",
  {
    description: "Rough current city from IP — SUGGESTION ONLY, not delivery-accurate. Use it to seed a search_places query, then have the user confirm the precise address.",
    inputSchema: {},
    annotations: READ,
  },
  async () => run(() => api.ipLocation()),
);

server.registerTool(
  "set_address_from_place",
  {
    description: "Resolve a place_id to exact coordinates and save it as the delivery address. Preferred over set_address — guarantees real coordinates for delivery.",
    inputSchema: { place_id: z.string(), house_no: z.string().optional() },
    annotations: WRITE,
  },
  async ({ place_id, house_no }) => run(() => api.setAddressFromPlace(place_id, house_no)),
);

// ── Discovery ─────────────────────────────────────────────────────────────────

server.registerTool(
  "get_config",
  { description: "Fetch storefront config (verticals, currencies, feature flags).", inputSchema: {}, annotations: READ },
  async () => run(() => api.getConfig(), { slim: true }),
);

server.registerTool(
  "list_vendors",
  {
    description: "List vendors (restaurants, shops, pharmacies...) near the current address, with optional filters.",
    inputSchema: {
      vendor_type: z.string().optional(),
      tag: z.string().optional(),
      q: z.string().optional(),
      address_id: z.number().optional(),
      sort: z.enum(["rating", "delivery_time", "distance"]).optional().describe("Sort order"),
      open_now: z.boolean().optional().describe("Only vendors open right now"),
      min_rating: z.number().min(0).max(5).optional(),
      max_delivery_fee: z.number().optional().describe("Cap the delivery fee (NGN)"),
      free_delivery: z.boolean().optional(),
      page: z.number().int().min(1).optional(),
    },
    annotations: READ,
  },
  async (args) => run(() => api.getVendors(args), { slim: true }),
);

server.registerTool(
  "featured_vendors",
  {
    description: "List featured/handpicked/explore vendors near the current address.",
    inputSchema: { tag: z.enum(["featured", "handpicked", "explore"]) },
    annotations: READ,
  },
  async ({ tag }) => run(() => api.getFeaturedVendors(tag), { slim: true }),
);

server.registerTool(
  "search",
  {
    description: "Search vendors and meals near the current address, with optional filters.",
    inputSchema: {
      q: z.string(),
      sort: z.enum(["rating", "delivery_time", "distance"]).optional(),
      open_now: z.boolean().optional(),
      min_rating: z.number().min(0).max(5).optional(),
    },
    annotations: READ,
  },
  async ({ q, ...filters }) => run(() => api.searchVendors(q, filters), { slim: true }),
);

server.registerTool(
  "get_menu_categories",
  { description: "List menu categories for a vendor.", inputSchema: { vendor_id: z.number() }, annotations: READ },
  async ({ vendor_id }) => run(() => api.getMenuCategories(vendor_id), { slim: true }),
);

server.registerTool(
  "get_menu",
  { description: "List a vendor's full menu.", inputSchema: { vendor_id: z.number() }, annotations: READ },
  async ({ vendor_id }) => run(() => api.getMenu(vendor_id), { slim: true }),
);

server.registerTool(
  "get_menu_item",
  {
    description: "Get full details for one menu item (options, add-ons, price).",
    inputSchema: { vendor_id: z.number(), menu_id: z.number() },
    annotations: READ,
  },
  async ({ vendor_id, menu_id }) => run(() => api.getMenuItem(vendor_id, menu_id), { slim: true }),
);

// ── Favourites ──────────────────────────────────────────────────────────────

server.registerTool(
  "list_favorites",
  { description: "List the user's saved/favourite vendors (requires login).", inputSchema: {}, annotations: READ },
  async () => run(() => api.listFavorites(), { slim: true }),
);

server.registerTool(
  "add_favorite",
  { description: "Save a vendor to the user's favourites (requires login).", inputSchema: { vendor_id: z.number() }, annotations: WRITE },
  async ({ vendor_id }) => run(() => api.addFavorite(vendor_id)),
);

server.registerTool(
  "remove_favorite",
  { description: "Remove a vendor from the user's favourites (requires login).", inputSchema: { vendor_id: z.number() }, annotations: WRITE },
  async ({ vendor_id }) => run(() => api.removeFavorite(vendor_id)),
);

// ── Cart ──────────────────────────────────────────────────────────────────────

server.registerTool(
  "reorder",
  {
    description: "Rebuild a cart from a past order so the user can place it again. Pass a past order_id (from get_order_history). Returns the new cart; confirm and checkout as usual.",
    inputSchema: { order_id: z.string() },
    annotations: WRITE,
  },
  async ({ order_id }) => run(() => api.reorder(order_id)),
);

server.registerTool("get_carts", { description: "List all carts for the current session.", inputSchema: {}, annotations: READ }, async () =>
  run(() => api.getCarts(), { slim: true }),
);

server.registerTool(
  "clear_carts",
  { description: "Delete ALL carts for the current session. Requires confirm:true.", inputSchema: { ...CONFIRM }, annotations: DESTRUCTIVE },
  async ({ confirm }) => {
    if (!confirm) return needConfirm("delete every cart in the current session");
    return run(() => api.clearCarts());
  },
);

server.registerTool(
  "delete_cart",
  { description: "Delete one cart by id. Requires confirm:true.", inputSchema: { cart_id: z.number(), ...CONFIRM }, annotations: DESTRUCTIVE },
  async ({ cart_id, confirm }) => {
    if (!confirm) return needConfirm(`delete cart ${cart_id}`);
    return run(() => api.deleteCart(cart_id));
  },
);

server.registerTool(
  "get_vendor_cart",
  { description: "Get the cart for one vendor.", inputSchema: { vendor_id: z.number() }, annotations: READ },
  async ({ vendor_id }) => run(() => api.getCartByVendor(vendor_id), { slim: true }),
);

server.registerTool(
  "update_cart",
  {
    description: "Create or update a cart with items for a vendor. Works as guest after set_address.",
    inputSchema: {
      vendor_id: z.number(),
      items: z.array(
        z.object({
          item_id: z.number(),
          quantity: z.number().int().min(1).max(99),
          type: z.string().default("menu"),
        }),
      ),
      address_id: z.number().optional(),
    },
    annotations: WRITE,
  },
  async (args) => run(() => api.createOrUpdateCart(args)),
);

// ── Auth ──────────────────────────────────────────────────────────────────────

server.registerTool(
  "login_send_otp",
  {
    description: "Start phone login: validates the phone and sends an OTP via SMS/WhatsApp.",
    inputSchema: { phone: z.string(), country_code: z.string().default("NG") },
    annotations: WRITE,
  },
  async ({ phone, country_code }) =>
    run(async () => {
      await api.validatePhone(phone, country_code);
      return api.sendLoginOtp(phone, country_code);
    }),
);

server.registerTool(
  "login_verify_otp",
  {
    description: "Complete login with the OTP the user received. Stores the bearer token in session.",
    inputSchema: { phone: z.string(), otp: z.string(), country_code: z.string().default("NG") },
    annotations: WRITE,
  },
  async ({ phone, otp, country_code }) =>
    run(async () => {
      const result = await api.verifyOtp(phone, otp, country_code);
      if (session.token) session.phone = phone;
      return result;
    }),
);

server.registerTool("get_me", { description: "Get the authenticated user's profile.", inputSchema: {}, annotations: READ }, async () =>
  run(() => api.getMe(), { slim: true }),
);

// ── Account / setup ─────────────────────────────────────────────────────────────

server.registerTool(
  "get_setup_status",
  {
    description:
      "Call this FIRST every conversation. Aggregates auth, address, saved payment, wallet, order count, and payment preference. If not authenticated or no address, run first-time setup. After login it also tells you whether the user is NEW (empty account) or RETURNING (has saved data).",
    inputSchema: {},
    outputSchema: {
      authenticated: z.boolean(),
      phone: z.string().nullable().optional(),
      address_id: z.number().nullable().optional(),
      payment_pref: z.any().optional(),
      setup_complete: z.boolean(),
      user_type: z.enum(["new", "returning"]).optional(),
      address_count: z.number().optional(),
      saved_payment_count: z.number().optional(),
      wallet_balance: z.any().optional(),
      order_count: z.number().optional(),
      next: z.string().optional(),
      warning: z.string().optional(),
    },
    annotations: READ,
  },
  async () => {
    const out: any = {
      authenticated: !!session.token,
      phone: session.phone,
      address_id: session.addressId,
      payment_pref: session.paymentPref,
      setup_complete: !!session.token && !!session.addressId,
    };
    if (!session.token) {
      out.next = "Not logged in. Run login_send_otp -> login_verify_otp.";
      return { ...res(out), structuredContent: out };
    }
    try {
      const [addrRes, payRes, walletRes, ordersRes] = await Promise.allSettled([
        api.listAddresses(),
        api.getPaymentMethods(),
        api.getWallet(),
        api.getOrderHistory(),
      ]);
      const addresses = (addrRes.status === "fulfilled" && (addrRes.value as any)?.data) || [];
      const methods = (payRes.status === "fulfilled" && ((payRes.value as any)?.data ?? [])) || [];
      const wallet = walletRes.status === "fulfilled" ? (walletRes.value as any)?.data : null;
      const orders = (ordersRes.status === "fulfilled" && ((ordersRes.value as any)?.data ?? [])) || [];
      out.address_count = addresses.length;
      out.saved_payment_count = Array.isArray(methods) ? methods.length : 0;
      out.wallet_balance = wallet ? { total: wallet.total_balance, ...wallet.balances, currency: wallet.currency } : null;
      out.order_count = Array.isArray(orders) ? orders.length : 0;
      out.user_type = addresses.length > 0 || out.saved_payment_count > 0 || out.order_count > 0 ? "returning" : "new";
      out.next =
        out.user_type === "returning"
          ? "Returning user. Confirm the active address (get_active_address) and, if payment_pref is null, ask once and call set_payment_pref."
          : "New user. Resolve a delivery address (search_places -> set_address_from_place) and confirm it.";
    } catch (err: any) {
      out.warning = "Could not load full account profile: " + (err?.message ?? String(err));
    }
    return { ...res(out), structuredContent: out };
  },
);

server.registerTool("list_addresses", { description: "List the user's saved addresses (requires login).", inputSchema: {}, annotations: READ }, async () =>
  run(() => api.listAddresses(), { slim: true }),
);

server.registerTool(
  "get_active_address",
  {
    description: "Get the account's active/last-used address — the default delivery target. Confirm it with the user before ordering.",
    inputSchema: {},
    annotations: READ,
  },
  async () => run(() => api.getActiveAddress()),
);

server.registerTool(
  "use_address",
  {
    description: "Select a saved address as the active delivery address for this session (sets session.addressId and marks it active on Chowdeck). Use for returning users instead of creating a new address.",
    inputSchema: { address_id: z.number() },
    annotations: WRITE,
  },
  async ({ address_id }) =>
    run(async () => {
      const r = await api.setActiveAddress(address_id).catch(() => null);
      session.addressId = address_id;
      return { ok: true, address_id, set_active: r ?? "skipped" };
    }),
);

server.registerTool("get_wallet", { description: "Get the user's wallet balance (requires login).", inputSchema: {}, annotations: READ }, async () =>
  run(() => api.getWallet()),
);

server.registerTool(
  "get_order_history",
  { description: "List past orders (requires login). Optional status filter, e.g. 'completed'.", inputSchema: { status: z.string().optional() }, annotations: READ },
  async ({ status }) => run(() => api.getOrderHistory(status), { slim: true }),
);

server.registerTool(
  "set_payment_pref",
  {
    description: "Save the user's payment preference. mode 'default' = auto-use the chosen saved method (still confirm total); mode 'ask' = pick a method every order.",
    inputSchema: { mode: z.enum(["default", "ask"]), method_id: z.number().optional(), method_label: z.string().optional() },
    annotations: WRITE,
  },
  async ({ mode, method_id, method_label }) => {
    session.paymentPref = { mode, methodId: method_id, methodLabel: method_label };
    return res({ ok: true, payment_pref: session.paymentPref });
  },
);

// ── Orders / checkout ─────────────────────────────────────────────────────────

server.registerTool("get_active_orders", { description: "List the user's active orders (requires login).", inputSchema: {}, annotations: READ }, async () =>
  run(() => api.getActiveOrders(), { slim: true }),
);

server.registerTool("get_order", { description: "Get one order by id.", inputSchema: { order_id: z.string() }, annotations: READ }, async ({ order_id }) =>
  run(() => api.getOrder(order_id), { slim: true }),
);

server.registerTool("get_payment_methods", { description: "List saved payment methods (requires login).", inputSchema: {}, annotations: READ }, async () =>
  run(() => api.getPaymentMethods()),
);

server.registerTool(
  "get_delivery_fee",
  {
    description: "Quote the delivery fee for a vendor to the current address. Pass cart_id from the cart. Returns a fee object whose id is the fee_id needed for place_order.",
    inputSchema: { vendor_id: z.number(), cart_id: z.number().optional(), source_id: z.number().optional() },
    annotations: READ,
  },
  async (args) => run(() => api.getDeliveryFee(args)),
);

server.registerTool(
  "place_order",
  {
    description:
      "Place an order from a cart (requires login). DESTRUCTIVE — charges money. Requires confirm:true, which you should set ONLY after confirming items, vendor, delivery fee, and total with the user. STABLE for returning customers paying with a saved card (payment_method 'card' + payment_method_id). Online payment (online_payment / bank_transfer / pay_for_me) creates an unpaid order; use pay_for_me for a hosted link.",
    inputSchema: {
      vendor_id: z.number(),
      cart_id: z.number(),
      fee_id: z.number(),
      payment_method: z.string(),
      payment_method_id: z.number().optional(),
      online_channel: z.string().optional(),
      address_id: z.number().optional(),
      promo_codes: z.array(z.string()).optional(),
      customer_vendor_note: z.string().optional(),
      customer_delivery_note: z.string().optional(),
      split_payment_with_wallet: z.boolean().optional().describe("When true, uses wallet balance first and charges the card for the remainder. Requires payment_method 'card'."),
      scheduled_for: z.string().optional().describe("ISO 8601 time to schedule delivery instead of ASAP (best-effort)"),
      rider_tip: z.number().min(0).optional().describe("Optional tip for the rider, in NGN"),
      ...CONFIRM,
    },
    annotations: DESTRUCTIVE,
  },
  async (args) => {
    if (!args.confirm) {
      const extra = args.scheduled_for ? ` (scheduled for ${args.scheduled_for})` : "";
      const tip = args.rider_tip ? ` with a ₦${args.rider_tip} tip` : "";
      return needConfirm(`place this order and charge the selected payment method${tip}${extra}`);
    }
    return run(() => api.placeOrder(args));
  },
);

server.registerTool(
  "track_order",
  {
    description: "Compact live status of an order: status, ETA, delivery PIN, rider name/phone, payment status, and tracking link. Poll this to follow a delivery.",
    inputSchema: { order_id: z.string() },
    annotations: READ,
  },
  async ({ order_id }) => run(() => api.trackOrder(order_id)),
);

server.registerTool(
  "validate_promo",
  {
    description: "Check a promo / voucher code (optionally for a vendor or cart). If valid, pass it to place_order via promo_codes. Best-effort endpoint.",
    inputSchema: { code: z.string(), vendor_id: z.number().optional(), cart_id: z.number().optional() },
    annotations: READ,
  },
  async ({ code, vendor_id, cart_id }) => run(() => api.validatePromo(code, { vendor_id, cart_id })),
);

server.registerTool(
  "wallet_topup",
  {
    description: "Initialise a wallet top-up — returns a Paystack link the user completes to add money. DESTRUCTIVE (moves money); requires confirm:true after the user approves the amount. Best-effort endpoint.",
    inputSchema: { amount: z.number().positive().describe("Amount to add, in NGN"), channel: z.string().default("card"), ...CONFIRM },
    annotations: DESTRUCTIVE,
  },
  async ({ amount, channel, confirm }) => {
    if (!confirm) return needConfirm(`start a ₦${amount} wallet top-up via ${channel}`);
    return run(() => api.walletTopup(amount, channel));
  },
);

server.registerTool(
  "get_payment_channels",
  {
    description: "List available payment channels (card, bank_transfer, ussd, opay...). Each name is a valid `method` for start_order_payment.",
    inputSchema: {},
    annotations: READ,
  },
  async () => run(() => api.getPaymentChannels()),
);

server.registerTool(
  "start_order_payment",
  {
    description:
      "Initialize a Paystack payment for an unpaid order (placed with payment_method 'online_payment'). Returns authorization_url (the Paystack checkout link) + access_code. method = a channel name like 'card' or 'bank_transfer'. Call PROMPTLY after place_order — unpaid orders are abandoned within minutes.",
    inputSchema: { order_id: z.number(), method: z.string(), callback_url: z.string().optional() },
    annotations: WRITE,
  },
  async ({ order_id, method, callback_url }) => run(() => api.startOrderPayment(order_id, method, callback_url)),
);

server.registerTool(
  "verify_payment",
  { description: "Verify a payment transaction status.", inputSchema: { transaction_id: z.string() }, annotations: READ },
  async ({ transaction_id }) => run(() => api.verifyPayment(transaction_id)),
);

// ── Prompts ───────────────────────────────────────────────────────────────────
// Reusable, user-pickable flows. Each returns a user message that points the
// agent at the right tools while preserving the SKILL's safety rules
// (confirm address + total before ordering; never auto-charge).

function userPrompt(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

server.registerPrompt(
  "order_food",
  {
    title: "Order food on Chowdeck",
    description: "Run the full Chowdeck ordering flow: setup, find a vendor, build a cart, confirm, and check out.",
    argsSchema: { craving: z.string().optional().describe("What the user feels like eating, if known") },
  },
  ({ craving }) =>
    userPrompt(
      `Help me order food on Chowdeck${craving ? ` — I'm in the mood for ${craving}` : ""}.\n\n` +
        "Start by calling get_setup_status. If I'm not set up, run first-time setup (login + confirm delivery address). " +
        "Then find vendors/meals (search / list_vendors / featured_vendors), build a cart with update_cart, quote the fee with get_delivery_fee, " +
        "then show me the full summary — items, vendor, delivery fee, and total. Only after I approve should you call place_order with confirm:true. " +
        "After placing, give me the delivery PIN, rider info, and tracking link.",
    ),
);

server.registerPrompt(
  "find_food_near_me",
  {
    title: "Find food near me",
    description: "Discover vendors and meals near the saved delivery address, with optional filters.",
    argsSchema: { craving: z.string().optional(), open_now: z.string().optional().describe("'true' to only show vendors open now") },
  },
  ({ craving, open_now }) =>
    userPrompt(
      `What can I order on Chowdeck near me right now${craving ? ` for ${craving}` : ""}? ` +
        "Confirm my delivery address first (get_setup_status / get_active_address), then use search and list_vendors" +
        (open_now === "true" ? " with open_now:true" : "") +
        ". Show me a short, ranked list with rating, delivery time, and fee — don't dump full menus.",
    ),
);

server.registerPrompt(
  "track_my_order",
  {
    title: "Track my Chowdeck order",
    description: "Show the live status of the user's current (or a specific) order.",
    argsSchema: { order_id: z.string().optional().describe("A specific order id, if known") },
  },
  ({ order_id }) =>
    userPrompt(
      order_id
        ? `Track my Chowdeck order ${order_id} — call track_order and summarise status, ETA, rider, delivery PIN, and the tracking link.`
        : "Track my current Chowdeck order. Call get_active_orders, then track_order on the latest, and summarise status, ETA, rider, delivery PIN, and tracking link.",
    ),
);

server.registerPrompt(
  "reorder_my_usual",
  {
    title: "Reorder a past order",
    description: "Pick a recent order and place it again.",
    argsSchema: {},
  },
  () =>
    userPrompt(
      "I want to reorder something I've had before. Call get_order_history, show me my recent orders, and once I pick one, " +
        "use reorder to rebuild the cart, re-quote the delivery fee, confirm the total with me, then place_order with confirm:true.",
    ),
);

// Watermark banner -> stderr only (stdout is reserved for the MCP protocol).
process.stderr.write(
  "Chowdeck MCP · by Hendrix Nwaokolo (@thathman) · MIT · unofficial, not affiliated with Chowdeck\n",
);

const transport = new StdioServerTransport();
await server.connect(transport);
