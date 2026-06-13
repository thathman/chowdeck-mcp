/*!
 * Chowdeck MCP · session store
 * Author: Hendrix Nwaokolo (@thathman) <hello@airixmmedia.com>
 * License: CC BY 4.0 — copy/adapt with attribution. © 2026 Hendrix Nwaokolo.
 * Watermark: THATHMAN·CHOWDECK·MCP
 */
// Session state persisted to disk so login/OTP setup only happens once.
// Stored at ~/.chowdeck-mcp/session.json
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DIR = path.join(os.homedir(), ".chowdeck-mcp");
const FILE = path.join(DIR, "session.json");

export type PaymentPref = {
  mode: "default" | "ask";
  methodId?: number;
  methodLabel?: string;
};

type SessionState = {
  token: string | null;
  guestId: string | null;
  addressId: number | null;
  phone: string | null;
  paymentPref: PaymentPref | null;
};

const DEFAULTS: SessionState = {
  token: null,
  guestId: null,
  addressId: null,
  phone: null,
  paymentPref: null,
};

function load(): SessionState {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(state: SessionState) {
  try {
    // The file holds a bearer token — keep it private to the current user.
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(DIR, 0o700);
      fs.chmodSync(FILE, 0o600);
    } catch {
      // chmod may be unsupported (e.g. Windows) — directory ACLs still apply.
    }
  } catch {
    // persistence is best-effort; in-memory state still works
  }
}

// Proxy so any assignment (session.token = ...) is written to disk immediately.
export const session: SessionState = new Proxy(load(), {
  set(target, prop, value) {
    (target as any)[prop] = value;
    save(target);
    return true;
  },
});

export function clearSession() {
  session.token = null;
  session.guestId = null;
  session.addressId = null;
  session.phone = null;
  session.paymentPref = null;
}
