import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * nTZS (https://www.ntzs.co.tz/developers) — mobile-money COLLECTIONS. The hotel asks for a payment; the customer gets
 * the mobile-money prompt on their phone (M-Pesa, Airtel Money, Tigo Pesa, HaloPesa, TTCL Pesa…) and approves it; nTZS
 * tells us by a signed webhook (`deposit.completed`) and the payment is recorded by itself.
 *
 * Keys are secrets — server env vars only (Vercel), never in the database or the browser:
 *   NTZS_API_KEY          ntzs_live_… (or ntzs_test_…)
 *   NTZS_WEBHOOK_SECRET   whsec_… — the webhook URL is <site>/api/webhooks/ntzs (set in the nTZS partner dashboard)
 *   NTZS_USER_ID          optional: collect for this nTZS user / merchant wallet instead of the platform treasury
 */

const BASE = (process.env.NTZS_BASE_URL || "https://www.ntzs.co.tz/api/v1").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;
/** The smallest mobile-money collection nTZS accepts. */
export const NTZS_MIN_TZS = 500;

export const ntzsEnabled = () => !!process.env.NTZS_API_KEY;
export const ntzsLive = () => (process.env.NTZS_API_KEY ?? "").startsWith("ntzs_live_");

/** "+255712345678" / "0712 345 678" / "255712345678" → "255712345678" (nTZS's format), or null when not a Tanzanian mobile. */
export function ntzsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 10) d = `255${d.slice(1)}`;
  if (d.length === 9 && /^[67]/.test(d)) d = `255${d}`;
  return /^255[67]\d{8}$/.test(d) ? d : null;
}

export interface NtzsDeposit {
  id: string;
  status: string;
  amountTzs?: number;
  paymentMethod?: string;
  instructions?: string;
  pspReference?: string | null;
  txHash?: string | null;
  externalReference?: string | null;
}
type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number; code?: string };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  const key = process.env.NTZS_API_KEY;
  if (!key) return { ok: false, error: "nTZS is not set up — add NTZS_API_KEY in the server settings." };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const j = (json ?? {}) as { error?: string | { code?: string; message?: string }; message?: string; code?: string };
      const code = typeof j.error === "object" ? j.error?.code : j.code ?? (typeof j.error === "string" ? j.error : undefined);
      const message = (typeof j.error === "object" ? j.error?.message : undefined) ?? j.message ?? (typeof j.error === "string" ? j.error : undefined) ?? text.slice(0, 200);
      return { ok: false, status: res.status, code, error: friendly(code, message, res.status) };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: `nTZS did not answer (${(e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message}) — try again.` };
  }
}

function friendly(code: string | undefined, message: string | undefined, status: number) {
  switch (code) {
    case "invalid_phone": return "That phone number is not a Tanzanian mobile-money number.";
    case "invalid_amount": return `The amount must be at least TZS ${NTZS_MIN_TZS.toLocaleString("en-US")}.`;
    case "rate_limited": return "nTZS is busy — wait a few seconds and try again.";
  }
  if (status === 401 || status === 403) return "nTZS refused the hotel's key — check NTZS_API_KEY.";
  return `nTZS: ${message || `error ${status}`}`;
}

/**
 * Ask the customer's phone for a payment. The money is collected to the hotel's nTZS account (its treasury, or the
 * wallet of NTZS_USER_ID); `reference` is ours and comes back on the webhook.
 */
export function createNtzsDeposit(input: { amountTzs: number; phone: string; reference: string; name?: string | null }) {
  const userId = process.env.NTZS_USER_ID || null;
  return call<NtzsDeposit>("POST", "/deposits", {
    amountTzs: Math.round(input.amountTzs),
    paymentMethod: "mobile_money",
    phoneNumber: input.phone,
    collectToTreasury: true,
    externalReference: input.reference,
    ...(userId ? { userId } : { endUser: { reference: input.reference, ...(input.name ? { name: input.name.slice(0, 80) } : {}), phone: input.phone } }),
  });
}

/** A deposit's state now (when no webhook came — the scheduled check and the screen waiting for it ask). */
export function getNtzsDeposit(id: string) {
  return call<NtzsDeposit>("GET", `/deposits/${encodeURIComponent(id)}`);
}

/** Paid? nTZS says "completed" once the money is in (mobile money settles in real time). */
export const depositCompleted = (status: string | null | undefined) => (status ?? "").toLowerCase() === "completed";
/** A deposit that will never complete (the customer refused, the prompt expired…) — whatever word nTZS uses for it. */
export const depositFailed = (status: string | null | undefined) => /fail|reject|cancel|expire|declin|error|revers/i.test(status ?? "");

/**
 * The webhook is genuine: HMAC-SHA256 (hex) of `${timestamp}.${rawBody}` with NTZS_WEBHOOK_SECRET, and recent (10 min —
 * the timestamp may be in seconds, milliseconds or an ISO date).
 */
export function verifyNtzsWebhook(rawBody: string, signature: string | null, timestamp: string | null, now = Date.now()): boolean {
  const secret = process.env.NTZS_WEBHOOK_SECRET;
  if (!secret || !signature || !timestamp) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const got = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  const a = Buffer.from(expected, "utf8"), b = Buffer.from(got, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const n = Number(timestamp);
  const at = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(timestamp);
  return Number.isFinite(at) && Math.abs(now - at) <= 10 * 60_000;
}
