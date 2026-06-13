/*!
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  Chowdeck MCP — Model Context Protocol server for Chowdeck food delivery    │
 * │                                                                            │
 * │  Author : Hendrix Nwaokolo  (@thathman)                                    │
 * │  Contact: hello@airixmmedia.com                                      │
 * │  Source : https://github.com/thathman/chowdeck-mcp                         │
 * │  License: CC BY 4.0 — copy/adapt freely WITH attribution to the author.    │
 * │                                                                            │
 * │  © 2026 Hendrix Nwaokolo.  Watermark: THATHMAN·CHOWDECK·MCP                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as api from "./api.js";
import { session, clearSession } from "./session.js";

const server = new McpServer({ name: "chowdeck", version: "0.1.1" });

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (err: any) {
    const detail = err?.response?.data ?? err?.message ?? String(err);
    return { ...json({ error: detail }), isError: true };
  }
}

// ── Session / address ─────────────────────────────────────────────────────────

server.tool(
  "set_address",
  "Create a delivery address (works as guest). Stores the address id for later calls.",
  {
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
  async (args) => run(() => api.createAddress(args)),
);

server.tool(
  "get_session",
  "Show current session state. Call this FIRST: if setup_complete is false, run the first-time setup flow (login + address).",
  {},
  async () =>
    json({
      authenticated: !!session.token,
      phone: session.phone,
      guest_id: session.guestId,
      address_id: session.addressId,
      payment_pref: session.paymentPref,
      setup_complete: !!session.token && !!session.addressId,
    }),
);

server.tool("logout", "Clear the saved session (token, address, guest id) from disk.", {}, async () => {
  clearSession();
  return json({ ok: true });
});

// ── Location / geocoding ───────────────────────────────────────────────────────

server.tool(
  "search_places",
  "Search delivery addresses by text (Chowdeck place autocomplete). Returns predictions with place_id and description. Show these to the user and let THEM pick the correct one.",
  { input: z.string() },
  async ({ input }) => run(() => api.searchPlaces(input)),
);

server.tool(
  "place_details",
  "Get the exact coordinates and formatted address for a place_id from search_places.",
  { place_id: z.string() },
  async ({ place_id }) => run(() => api.placeDetails(place_id)),
);

server.tool(
  "reverse_geocode",
  "Turn precise device coordinates (lat/lng) into address candidates. Use when the host can provide the user's current GPS location.",
  { latitude: z.number(), longitude: z.number() },
  async ({ latitude, longitude }) => run(() => api.reverseGeocode(latitude, longitude)),
);

server.tool(
  "suggest_current_location",
  "Rough current city from IP — SUGGESTION ONLY, not delivery-accurate. Use it to seed a search_places query, then have the user confirm the precise address.",
  {},
  async () => run(() => api.ipLocation()),
);

server.tool(
  "set_address_from_place",
  "Resolve a place_id to exact coordinates and save it as the delivery address. Preferred over set_address — guarantees real coordinates for delivery.",
  { place_id: z.string(), house_no: z.string().optional() },
  async ({ place_id, house_no }) => run(() => api.setAddressFromPlace(place_id, house_no)),
);

// ── Discovery ─────────────────────────────────────────────────────────────────

server.tool("get_config", "Fetch storefront config (verticals, currencies, feature flags).", {}, async () =>
  run(() => api.getConfig()),
);

server.tool(
  "list_vendors",
  "List vendors (restaurants, shops, pharmacies...) near the current address.",
  {
    vendor_type: z.string().optional(),
    tag: z.string().optional(),
    q: z.string().optional(),
    address_id: z.number().optional(),
  },
  async (args) => run(() => api.getVendors(args)),
);

server.tool(
  "featured_vendors",
  "List featured/handpicked/explore vendors near the current address.",
  { tag: z.enum(["featured", "handpicked", "explore"]) },
  async ({ tag }) => run(() => api.getFeaturedVendors(tag)),
);

server.tool("search", "Search vendors and meals near the current address.", { q: z.string() }, async ({ q }) =>
  run(() => api.searchVendors(q)),
);

server.tool(
  "get_menu_categories",
  "List menu categories for a vendor.",
  { vendor_id: z.number() },
  async ({ vendor_id }) => run(() => api.getMenuCategories(vendor_id)),
);

server.tool("get_menu", "List a vendor's full menu.", { vendor_id: z.number() }, async ({ vendor_id }) =>
  run(() => api.getMenu(vendor_id)),
);

server.tool(
  "get_menu_item",
  "Get full details for one menu item (options, add-ons, price).",
  { vendor_id: z.number(), menu_id: z.number() },
  async ({ vendor_id, menu_id }) => run(() => api.getMenuItem(vendor_id, menu_id)),
);

// ── Cart ──────────────────────────────────────────────────────────────────────

server.tool("get_carts", "List all carts for the current session.", {}, async () => run(() => api.getCarts()));

server.tool("clear_carts", "Delete all carts for the current session.", {}, async () => run(() => api.clearCarts()));

server.tool("delete_cart", "Delete one cart by id.", { cart_id: z.number() }, async ({ cart_id }) =>
  run(() => api.deleteCart(cart_id)),
);

server.tool(
  "get_vendor_cart",
  "Get the cart for one vendor.",
  { vendor_id: z.number() },
  async ({ vendor_id }) => run(() => api.getCartByVendor(vendor_id)),
);

server.tool(
  "update_cart",
  "Create or update a cart with items for a vendor. Works as guest after set_address.",
  {
    vendor_id: z.number(),
    items: z.array(z.object({ item_id: z.number(), quantity: z.number(), type: z.string().default("menu") })),
    address_id: z.number().optional(),
  },
  async (args) => run(() => api.createOrUpdateCart(args)),
);

// ── Auth ──────────────────────────────────────────────────────────────────────

server.tool(
  "login_send_otp",
  "Start phone login: validates the phone and sends an OTP via SMS/WhatsApp.",
  { phone: z.string(), country_code: z.string().default("NG") },
  async ({ phone, country_code }) =>
    run(async () => {
      await api.validatePhone(phone, country_code);
      return api.sendLoginOtp(phone, country_code);
    }),
);

server.tool(
  "login_verify_otp",
  "Complete login with the OTP the user received. Stores the bearer token in session.",
  { phone: z.string(), otp: z.string(), country_code: z.string().default("NG") },
  async ({ phone, otp, country_code }) =>
    run(async () => {
      const res = await api.verifyOtp(phone, otp, country_code);
      if (session.token) session.phone = phone;
      return res;
    }),
);

server.tool("get_me", "Get the authenticated user's profile.", {}, async () => run(() => api.getMe()));

// ── Account / setup ─────────────────────────────────────────────────────────────

server.tool(
  "get_setup_status",
  "Call this FIRST every conversation. Aggregates auth, address, saved payment, wallet, order count, and payment preference. If not authenticated or no address, run first-time setup. After login it also tells you whether the user is NEW (empty account) or RETURNING (has saved data).",
  {},
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
      return json(out);
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
      out.wallet_balance = wallet
        ? { total: wallet.total_balance, ...wallet.balances, currency: wallet.currency }
        : null;
      out.order_count = Array.isArray(orders) ? orders.length : 0;
      out.user_type =
        addresses.length > 0 || out.saved_payment_count > 0 || out.order_count > 0 ? "returning" : "new";
      out.next =
        out.user_type === "returning"
          ? "Returning user. Confirm the active address (get_active_address) and, if payment_pref is null, ask once and call set_payment_pref."
          : "New user. Resolve a delivery address (search_places -> set_address_from_place) and confirm it.";
    } catch (err: any) {
      out.warning = "Could not load full account profile: " + (err?.message ?? String(err));
    }
    return json(out);
  },
);

server.tool("list_addresses", "List the user's saved addresses (requires login).", {}, async () =>
  run(() => api.listAddresses()),
);

server.tool(
  "get_active_address",
  "Get the account's active/last-used address — the default delivery target. Confirm it with the user before ordering.",
  {},
  async () => run(() => api.getActiveAddress()),
);

server.tool(
  "use_address",
  "Select a saved address as the active delivery address for this session (sets session.addressId and marks it active on Chowdeck). Use for returning users instead of creating a new address.",
  { address_id: z.number() },
  async ({ address_id }) =>
    run(async () => {
      const res = await api.setActiveAddress(address_id).catch(() => null);
      session.addressId = address_id;
      return { ok: true, address_id, set_active: res ?? "skipped" };
    }),
);

server.tool("get_wallet", "Get the user's wallet balance (requires login).", {}, async () => run(() => api.getWallet()));

server.tool(
  "get_order_history",
  "List past orders (requires login). Optional status filter, e.g. 'completed'.",
  { status: z.string().optional() },
  async ({ status }) => run(() => api.getOrderHistory(status)),
);

server.tool(
  "set_payment_pref",
  "Save the user's payment preference. mode 'default' = auto-use the chosen saved method (still confirm total); mode 'ask' = pick a method every order.",
  {
    mode: z.enum(["default", "ask"]),
    method_id: z.number().optional(),
    method_label: z.string().optional(),
  },
  async ({ mode, method_id, method_label }) => {
    session.paymentPref = { mode, methodId: method_id, methodLabel: method_label };
    return json({ ok: true, payment_pref: session.paymentPref });
  },
);

// ── Orders / checkout ─────────────────────────────────────────────────────────

server.tool("get_active_orders", "List the user's active orders (requires login).", {}, async () =>
  run(() => api.getActiveOrders()),
);

server.tool("get_order", "Get one order by id.", { order_id: z.string() }, async ({ order_id }) =>
  run(() => api.getOrder(order_id)),
);

server.tool("get_payment_methods", "List saved payment methods (requires login).", {}, async () =>
  run(() => api.getPaymentMethods()),
);

server.tool(
  "get_delivery_fee",
  "Quote the delivery fee for a vendor to the current address. Pass cart_id from the cart. Returns a fee object whose id is the fee_id needed for place_order.",
  { vendor_id: z.number(), cart_id: z.number().optional(), source_id: z.number().optional() },
  async (args) => run(() => api.getDeliveryFee(args)),
);

server.tool(
  "place_order",
  "Place an order from a cart (requires login). STABLE for returning customers paying with a saved card (payment_method 'card' + payment_method_id) — charges inline. Online payment (online_payment / bank_transfer / pay_for_me) is IN PROGRESS: the order is created unpaid; use pay_for_me to get a hosted payment link.",
  {
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
  },
  async (args) => run(() => api.placeOrder(args)),
);

server.tool(
  "get_payment_channels",
  "List available payment channels (card, bank_transfer, ussd, opay...). Each name is a valid `method` for start_order_payment.",
  {},
  async () => run(() => api.getPaymentChannels()),
);

server.tool(
  "start_order_payment",
  "Initialize a Paystack payment for an unpaid order (placed with payment_method 'online_payment'). Returns authorization_url (the Paystack checkout link) + access_code. method = a channel name like 'card' or 'bank_transfer'. Call PROMPTLY after place_order — unpaid orders are abandoned within minutes.",
  { order_id: z.number(), method: z.string(), callback_url: z.string().optional() },
  async ({ order_id, method, callback_url }) => run(() => api.startOrderPayment(order_id, method, callback_url)),
);

server.tool(
  "verify_payment",
  "Verify a payment transaction status.",
  { transaction_id: z.string() },
  async ({ transaction_id }) => run(() => api.verifyPayment(transaction_id)),
);

// Watermark banner -> stderr only (stdout is reserved for the MCP protocol).
process.stderr.write(
  "Chowdeck MCP · by Hendrix Nwaokolo (@thathman) · CC BY 4.0 · THATHMAN·CHOWDECK·MCP\n",
);

const transport = new StdioServerTransport();
await server.connect(transport);
