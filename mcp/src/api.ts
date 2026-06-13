/*!
 * Chowdeck MCP · API client
 * Author: Hendrix Nwaokolo (@thathman) <hello@airixmmedia.com>
 * License: CC BY 4.0 — copy/adapt with attribution. © 2026 Hendrix Nwaokolo.
 * Watermark: THATHMAN·CHOWDECK·MCP
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { session } from "./session.js";

const BASE = process.env.CHOWDECK_API_BASE ?? "https://api.chowdeck.com";
const APP_VERSION = process.env.CHOWDECK_APP_VERSION ?? "2.0.0";
const TIMEOUT_MS = Number(process.env.CHOWDECK_TIMEOUT_MS ?? 15000);
const MAX_RETRIES = Number(process.env.CHOWDECK_MAX_RETRIES ?? 2);

function client(): AxiosInstance {
  const headers: Record<string, string> = {
    "x-app-name": "storefront",
    "x-app-os": "web",
    "accept": "application/json",
    "content-type": "application/json",
  };
  if (session.token) headers["Authorization"] = `Bearer ${session.token}`;
  if (session.guestId) headers["x-guest-id"] = session.guestId;
  const instance = axios.create({ baseURL: BASE, headers, timeout: TIMEOUT_MS });
  // Retry only transient failures (network errors / 5xx) with linear backoff.
  // Never retries 4xx; order placement opts out via _noRetry to avoid dupes.
  instance.interceptors.response.use(undefined, async (error) => {
    const cfg = error.config as (AxiosRequestConfig & { _retry?: number; _noRetry?: boolean }) | undefined;
    if (!cfg || cfg._noRetry) throw error;
    const status = error.response?.status;
    const transient = status === undefined || status >= 500;
    cfg._retry = (cfg._retry ?? 0) + 1;
    if (!transient || cfg._retry > MAX_RETRIES) throw error;
    await new Promise((r) => setTimeout(r, 400 * cfg._retry!));
    return instance(cfg);
  });
  return instance;
}

// ── Location / geocoding ───────────────────────────────────────────────────────
// Chowdeck proxies Google Places autocomplete + details through its own API.
// Reverse geocoding (current coords -> address) needs a Google Maps key. Supply
// your OWN key via CHOWDECK_MAPS_KEY — never embed a third party's key.
const MAPS_KEY = process.env.CHOWDECK_MAPS_KEY ?? "";

export async function searchPlaces(input: string) {
  return (await client().get("/place/autocomplete/json", { params: { input } })).data;
}

export async function placeDetails(placeId: string) {
  return (await client().get("/place/details/json", { params: { placeid: placeId } })).data;
}

export async function reverseGeocode(lat: number, lng: number) {
  if (!MAPS_KEY) {
    throw new Error(
      "Reverse geocoding needs your own Google Maps key (set CHOWDECK_MAPS_KEY). Use search_places to resolve the address instead.",
    );
  }
  const url = "https://maps.googleapis.com/maps/api/geocode/json";
  return (await axios.get(url, { params: { latlng: `${lat},${lng}`, key: MAPS_KEY }, timeout: TIMEOUT_MS })).data;
}

// Rough current location from IP — for SUGGESTION ONLY; never order against it
// without the user confirming the precise address. Uses an HTTPS provider.
export async function ipLocation() {
  const r = (await axios.get("https://ipapi.co/json/", { timeout: TIMEOUT_MS })).data;
  return {
    status: r?.error ? "fail" : "success",
    city: r?.city,
    regionName: r?.region,
    country: r?.country_name,
    lat: r?.latitude,
    lon: r?.longitude,
    query: r?.ip,
  };
}

function componentsToAddress(result: any, houseNo?: string) {
  const comps: any[] = result.address_components ?? [];
  const pick = (type: string) => comps.find((c) => c.types?.includes(type))?.long_name;
  const loc = result.geometry?.location ?? {};
  return {
    place_id: String(result.place_id ?? ""),
    house_no: houseNo,
    street: pick("route") ?? result.name ?? result.formatted_address ?? "",
    pretty_name: result.formatted_address ?? result.name ?? "",
    longitude: loc.lng,
    latitude: loc.lat,
    city: pick("locality") ?? pick("administrative_area_level_2") ?? "",
    state: pick("administrative_area_level_1") ?? "",
    country: pick("country") ?? "Nigeria",
    area: pick("sublocality") ?? pick("neighborhood"),
  };
}

// Resolve a place_id to exact coordinates and create the delivery address.
export async function setAddressFromPlace(placeId: string, houseNo?: string) {
  const details = await placeDetails(placeId);
  const result = details?.result ?? details?.data?.result ?? details?.data;
  if (!result?.geometry?.location) throw new Error("Could not resolve coordinates for that place.");
  const body = componentsToAddress(result, houseNo);
  return createAddress(body as any);
}

// ── Discovery ─────────────────────────────────────────────────────────────────

export async function getConfig() {
  return (await client().get("/customer/config?currency=NGN")).data;
}

export async function createAddress(body: {
  place_id?: string;
  house_no?: string;
  street: string;
  pretty_name: string;
  longitude: number;
  latitude: number;
  city: string;
  state: string;
  country: string;
  area?: string;
}) {
  const res = (await client().post("/customer/address", body)).data;
  if (res?.data?.id) session.addressId = res.data.id;
  return res;
}

export async function getVendors(params: {
  address_id?: number;
  vendor_type?: string;
  tag?: string;
  q?: string;
}) {
  const id = params.address_id ?? session.addressId;
  if (!id) throw new Error("No address set. Call set_address first.");
  return (await client().get("/customer/vendor/v2", { params: { address_id: id, ...params } })).data;
}

export async function getFeaturedVendors(tag: "featured" | "handpicked" | "explore") {
  if (!session.addressId) throw new Error("No address set. Call set_address first.");
  return (await client().get("/customer/vendor/special/v2", {
    params: { tag, address_id: session.addressId },
  })).data;
}

export async function getMenuCategories(vendorId: number) {
  return (await client().get(`/customer/vendor/${vendorId}/menu-category`)).data;
}

export async function getMenu(vendorId: number) {
  return (await client().get(`/customer/vendor/${vendorId}/menu`, {
    params: { return_out_of_stock: 1 },
  })).data;
}

export async function getMenuItem(vendorId: number, menuId: number) {
  return (await client().get(`/customer/vendor/${vendorId}/menu/${menuId}`)).data;
}

export async function searchVendors(q: string) {
  if (!session.addressId) throw new Error("No address set. Call set_address first.");
  return (await client().get("/customer/search", {
    params: { q, address_id: session.addressId },
  })).data;
}

// ── Cart ──────────────────────────────────────────────────────────────────────

export async function getCarts() {
  return (await client().get("/customer/cart")).data;
}

export async function clearCarts() {
  return (await client().delete("/customer/cart/clear")).data;
}

export async function deleteCart(cartId: number) {
  return (await client().delete(`/customer/cart/${cartId}`)).data;
}

export async function getCartByVendor(vendorId: number) {
  return (await client().get(`/customer/cart/vendor/${vendorId}`)).data;
}

export async function createOrUpdateCart(body: {
  vendor_id: number;
  items: { item_id: number; quantity: number; type?: string }[];
  address_id?: number;
  class?: string;
}) {
  const payload = {
    source: "web",
    app_version: APP_VERSION,
    class: "delivery",
    address_id: session.addressId,
    ...body,
  };
  // If a cart already exists for this vendor, update it via the vendor endpoint;
  // otherwise create a fresh cart. POST /customer/cart only creates.
  let existing: any = null;
  try {
    existing = (await getCartByVendor(body.vendor_id))?.data;
  } catch {
    existing = null;
  }
  const res = existing?.id
    ? (await client().post(`/customer/cart/vendor/${body.vendor_id}`, payload)).data
    : (await client().post("/customer/cart", payload)).data;
  if (res?.data?.guest_id) session.guestId = res.data.guest_id;
  return res;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// Chowdeck's login/validate-otp endpoints reject E.164 (+234...) but accept the
// local Nigerian format. Normalize to 0XXXXXXXXXX.
export function normalizePhone(phone: string): string {
  let p = phone.replace(/[^\d]/g, "");
  if (p.startsWith("234")) p = p.slice(3);
  if (p.length === 10) p = "0" + p; // missing leading zero
  if (!p.startsWith("0")) p = "0" + p;
  // A Nigerian mobile number is 11 digits (0 + 10). Reject anything else so we
  // never fire an OTP at a malformed number.
  if (!/^0\d{10}$/.test(p)) {
    throw new Error(`"${phone}" is not a valid Nigerian phone number (expected 11 digits, e.g. 08012345678).`);
  }
  return p;
}

export async function validatePhone(phone: string, country_code = "NG") {
  return (await client().post("/auth/phone/validate", { phone: normalizePhone(phone), country_code })).data;
}

export async function sendLoginOtp(phone: string, country_code = "NG") {
  return (await client().post("/auth/login", { phone: normalizePhone(phone), country_code, role: "customer" })).data;
}

export async function verifyOtp(phone: string, otp: string, country_code = "NG") {
  const res = (await client().post("/auth/login/validate-otp", {
    otp, phone: normalizePhone(phone), country_code, role: "customer",
  })).data;
  const token = res?.data?.token ?? res?.data?.access_token;
  if (token) {
    session.token = token;
    // upgrade guest cart if we had one
    if (session.guestId) {
      await client().patch("/customer/cart/guest/upgrade").catch(() => null);
    }
  }
  return res;
}

export async function getMe() {
  return (await client().get("/auth/me?currency=NGN")).data;
}

// ── Account (authenticated) ─────────────────────────────────────────────────────

export async function listAddresses() {
  return (await client().get("/customer/address")).data;
}

export async function getActiveAddress() {
  const res: any = await listAddresses();
  const list: any[] = res?.data ?? [];
  const active =
    list.find((a) => a.is_current) ??
    list.find((a) => a.is_active) ??
    [...list].sort((a, b) => +new Date(b.last_used ?? 0) - +new Date(a.last_used ?? 0))[0] ??
    null;
  return active;
}

export async function setActiveAddress(addressId: number) {
  // Tells Chowdeck which saved address is active; also used by us to set session.
  return (await client().post("/customer/address/set-active", { address_id: addressId })).data;
}

export async function getWallet() {
  return (await client().get("/customer/wallet", {
    params: { currency: "NGN", new_response: true },
  })).data;
}

export async function getOrderHistory(status?: string) {
  return (await client().get("/customer/order", {
    params: status ? { status } : {},
    headers: { "x-chowdeck-api-version": "v2" },
  })).data;
}

// ── Orders ────────────────────────────────────────────────────────────────────

export async function getActiveOrders() {
  return (await client().get("/customer/order", {
    params: { status: "active" },
    headers: { "x-chowdeck-api-version": "v2" },
  })).data;
}

export async function getOrder(orderId: string) {
  return (await client().get(`/customer/order/${orderId}`)).data;
}

// Initialize a Paystack payment for an unpaid (online_payment) order. Returns
// access_code + authorization_url (the Paystack checkout link). method is the
// payment channel name from get_payment_channels, e.g. "card" or "bank_transfer".
// Must be called promptly after placing the order — unpaid orders are abandoned
// within a few minutes.
export async function startOrderPayment(orderId: number, method: string, callbackUrl?: string) {
  return (await client().post(`/order/${orderId}/payment`, {
    method,
    callback_url: callbackUrl ?? "https://chowdeck.com/store/track",
  })).data;
}

// ── Checkout ──────────────────────────────────────────────────────────────────

export async function getPaymentMethods() {
  return (await client().get("/customer/payment/methods", { params: { currency: "NGN" } })).data;
}

export async function getPaymentChannels(country_identifier = "NG") {
  return (await client().get("/customer/payment/channel", {
    params: { country_identifier },
  })).data;
}

export async function getVendor(vendorId: number) {
  return (await client().get(`/customer/vendor/${vendorId}`, {
    params: { address_id: session.addressId },
  })).data;
}

// Delivery fee. Chowdeck wants destination_id (customer address), source_id
// (vendor address), vendor_id, order_class, and cart_id. We auto-resolve the
// vendor's address_id if not supplied.
export async function getDeliveryFee(body: {
  vendor_id: number;
  cart_id?: number;
  destination_id?: number;
  source_id?: number;
  order_class?: string;
}) {
  let sourceId = body.source_id;
  if (!sourceId) {
    const v: any = await getVendor(body.vendor_id);
    sourceId = v?.data?.address_id;
  }
  const payload: Record<string, unknown> = {
    destination_id: body.destination_id ?? session.addressId,
    order_class: body.order_class ?? "delivery",
    source_id: sourceId,
    vendor_id: body.vendor_id,
  };
  if (body.cart_id) payload.cart_id = body.cart_id;
  return (await client().post("/customer/delivery/amount", payload)).data;
}

export async function placeOrder(body: {
  vendor_id: number;
  cart_id: number;
  fee_id: number;
  payment_method: string; // "card" | "wallet" | "online_payment" | "pay_for_me"
  payment_method_id?: number; // required for saved cards
  online_channel?: string; // for online_payment: seeds Paystack channel (card|bank_transfer|...)
  address_id?: number;
  promo_codes?: string[];
  customer_vendor_note?: string;
  customer_delivery_note?: string;
  split_payment_with_wallet?: boolean;
}) {
  // Build order_items from the live cart (Chowdeck expects them explicitly).
  const cartRes: any = await getCartByVendor(body.vendor_id);
  const cart = cartRes?.data;
  const orderItems = (cart?.cart_items ?? [])
    .filter((it: any) => it.type !== "container")
    .map((it: any) => ({ item_id: it.item_id, quantity: it.quantity, type: it.type ?? "menu", pack_id: 1 }));

  const payload: Record<string, unknown> = {
    source: "web",
    app_version: APP_VERSION,
    vendor_id: body.vendor_id,
    cart_id: body.cart_id,
    fee_id: body.fee_id,
    address_id: body.address_id ?? session.addressId,
    class: "delivery",
    checkout_from_cart: true,
    requires_delivery_pin: true,
    payment_method: body.payment_method,
    order_items: orderItems,
    bag_quantity: cart?.bag_quantity ?? 0,
    promo_codes: body.promo_codes ?? [],
  };
  if (body.payment_method === "pay_for_me") payload.has_external_payment = true;
  else if (body.payment_method_id) payload.payment_method_id = body.payment_method_id;
  if (body.customer_vendor_note) payload.customer_vendor_note = body.customer_vendor_note;
  if (body.customer_delivery_note) payload.customer_delivery_note = body.customer_delivery_note;
  if (body.split_payment_with_wallet) payload.split_payment_with_wallet = true;

  const res: any = (await client().post("/customer/order", payload, { _noRetry: true } as any)).data;

  // For online payment, immediately fetch the Paystack checkout link so the
  // order isn't abandoned. The hosted page lets the user pick card/transfer/etc;
  // online_channel just seeds it.
  if (body.payment_method === "online_payment" && res?.data?.id) {
    try {
      const pay: any = await startOrderPayment(res.data.id, body.online_channel ?? "card");
      res.data.payment = pay?.data ?? pay;
    } catch (err: any) {
      res.data.payment_error = err?.response?.data ?? err?.message ?? String(err);
    }
  }
  return res;
}

export async function startPayment(body: {
  order_id: number;
  method: string;
  pocket_tag?: string;
  return_url?: string;
}) {
  return (await client().post("/customer/payment/start/v2", body)).data;
}

export async function verifyPayment(transactionId: string) {
  return (await client().get(`/customer/payment/verify/${transactionId}`)).data;
}

export async function getOrderPaymentStatus(orderId: string) {
  return (await client().get(`/order/${orderId}/payment`)).data;
}
