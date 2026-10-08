import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { msg, msgf, type Localized } from "@/i18n/msg";

/**
 * nTZS (https://www.ntzs.co.tz/developers) — mobile-money COLLECTIONS. The hotel asks for a payment; the customer gets
 * the mobile-money prompt on their phone (M-Pesa, Airtel Money, Mixx by Yas, HaloPesa, TTCL Pesa…) and approves it; nTZS
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

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Result<T>> {
  const key = process.env.NTZS_API_KEY;
  if (!key) return { ok: false, error: msg("nTZS is not set up — add NTZS_API_KEY in the server settings.") };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const j = (json ?? {}) as { error?: string | { code?: string; message?: string }; message?: string; code?: string };
      const code = typeof j.error === "object" ? j.error?.code : j.code ?? (typeof j.error === "string" ? j.error : undefined);
      const message = (typeof j.error === "object" ? j.error?.message : undefined) ?? j.message ?? (typeof j.error === "string" ? j.error : undefined) ?? text.slice(0, 200);
      // What nTZS said, for the logs (never the key): the screens get it in plain words below.
      console.error("[ntzs] refused", { method, path: path.split("?")[0], status: res.status, code: code ?? null, message: message?.slice(0, 300) ?? null });
      return { ok: false, status: res.status, code, error: friendly(code, message, res.status) };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: msgf("nTZS did not answer ({reason}) — try again.", { reason: (e as Error).name === "TimeoutError" ? msg("timed out") : String((e as Error).message) }).text };
  }
}

/**
 * nTZS's answer in plain words for staff (customers get a shorter line — see friendlyForCustomer). Each refusal says
 * its own reason: a 403 is usually NOT the key (2026-10-05: a TZS 160,000 request was refused with `kyb_required` —
 * until nTZS approves the business, it collects at most TZS 100,000 — and the screen wrongly said "check the key").
 * The words stay English here (they are kept on the payment and read again); msg() marks those translated where shown.
 */
function friendly(code: string | undefined, message: string | undefined, status: number) {
  switch (code) {
    case "invalid_phone": return msg("That phone number is not a Tanzanian mobile-money number.");
    case "invalid_amount": return msgf("The amount must be at least TZS {amount}.", { amount: NTZS_MIN_TZS.toLocaleString("en-US") }).text;
    case "rate_limited": return msg("nTZS is busy — wait a few seconds and try again.");
    case "kyb_required": return msg("nTZS has not yet approved the hotel's business account (KYB). Until it does, mobile-money collections are limited to TZS 100,000 in total — ask nTZS to finish the approval, or use another payment method for now.");
    case "capability_required": return msg("The hotel's nTZS account is not allowed to collect payments yet — ask nTZS to switch collections on.");
    case "wallet_frozen": return msg("The hotel's nTZS wallet is frozen — contact nTZS.");
    case "ip_not_allowed": return msg("nTZS blocks this server (its IP allowlist) — switch the allowlist off in the nTZS dashboard.");
    case "user_not_found": return msg("nTZS does not know the hotel's wallet (NTZS_USER_ID) — check it in Vercel.");
  }
  if (status === 401) return msg("nTZS did not accept the hotel's API key — check NTZS_API_KEY in Vercel (it may have been changed in the nTZS dashboard).");
  if (status === 403) return message ? msgf("nTZS refused this request ({code}) — {message}.", { code: code ?? "403", message: message.slice(0, 160) }).text : msgf("nTZS refused this request ({code}).", { code: code ?? "403" }).text;
  return `nTZS: ${message || `error ${status}`}`;
}

/**
 * A refusal as friendly() wrote it, kept translatable for the staff member who sees it (an AppError's message): the
 * English is exactly the same; the sentences with values in them are said again with those values.
 */
export function ntzsSaid(error: string): string | Localized {
  let m: RegExpExecArray | null;
  if ((m = /^The amount must be at least TZS ([\d,]+)\.$/.exec(error))) return msgf("The amount must be at least TZS {amount}.", { amount: m[1] });
  if ((m = /^nTZS refused this request \(([^)]*)\) — ([\s\S]*)\.$/.exec(error))) return msgf("nTZS refused this request ({code}) — {message}.", { code: m[1], message: m[2] });
  if ((m = /^nTZS refused this request \(([^)]*)\)\.$/.exec(error))) return msgf("nTZS refused this request ({code}).", { code: m[1] });
  if ((m = /^nTZS did not answer \(([\s\S]*)\) — try again\.$/.exec(error))) return msgf("nTZS did not answer ({reason}) — try again.", { reason: m[1] });
  return error;
}

/**
 * Ask the customer's phone for a payment. The money is collected to the hotel's nTZS account (its treasury, or the
 * wallet of NTZS_USER_ID); `reference` is ours and comes back on the webhook.
 */
export async function createNtzsDeposit(input: { amountTzs: number; phone: string; reference: string; name?: string | null }): Promise<Result<NtzsDeposit>> {
  const userId = process.env.NTZS_USER_ID || null;
  const res = await call<unknown>("POST", "/deposits", {
    amountTzs: Math.round(input.amountTzs),
    paymentMethod: "mobile_money",
    phoneNumber: input.phone,
    collectToTreasury: true,
    externalReference: input.reference,
    ...(userId ? { userId } : { endUser: { reference: input.reference, ...(input.name ? { name: input.name.slice(0, 80) } : {}), phone: input.phone } }),
  }, { "Idempotency-Key": input.reference }); // one request per attempt, even if it reaches nTZS twice
  if (!res.ok) return res;
  const d = readDeposit(res.data);
  if (!d.id) return { ok: false, error: msg("nTZS did not return the payment's id — try again.") };
  const raw = (res.data ?? {}) as { instructions?: unknown; data?: { instructions?: unknown } };
  const instructions = typeof raw.instructions === "string" ? raw.instructions : typeof raw.data?.instructions === "string" ? raw.data.instructions : undefined;
  return { ok: true, data: { ...d, instructions } };
}

/** A deposit's state now (when no webhook came — the scheduled check and the screen waiting for it ask). */
export async function getNtzsDeposit(id: string): Promise<Result<NtzsDeposit>> {
  const res = await call<unknown>("GET", `/deposits/${encodeURIComponent(id)}`);
  if (!res.ok) return res;
  return { ok: true, data: readDeposit(res.data, id) };
}

/** A deposit as nTZS sends it — at the top level, or wrapped ({ data: … } / { deposit: … }); amounts as a number or text. */
export function readDeposit(raw: unknown, fallbackId: string | null = null): NtzsDeposit {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inner = [o.deposit, o.data].find((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown> | undefined;
  const d = inner && ("status" in inner || "id" in inner || "depositId" in inner) ? inner : o;
  const str = (...v: unknown[]) => { const x = v.find((y) => typeof y === "string" && y.trim()); return typeof x === "string" ? x.trim() : null; };
  const num = (...v: unknown[]) => { for (const y of v) { const n = typeof y === "number" ? y : typeof y === "string" ? Number(y) : NaN; if (Number.isFinite(n) && n > 0) return n; } return undefined; };
  return {
    id: str(d.id, d.depositId, d.deposit_id) ?? fallbackId ?? "",
    status: (str(d.status, d.state) ?? "").toLowerCase(),
    amountTzs: num(d.amountTzs, d.amount_tzs, d.amount),
    pspReference: str(d.pspReference, d.psp_reference, d.providerReference),
    txHash: str(d.txHash, d.tx_hash),
    externalReference: str(d.externalReference, d.external_reference),
  };
}

/**
 * Paid? Once the customer's mobile money is in, nTZS mints the TZS to the hotel's treasury: the deposit reads
 * "minted" (its dashboard) or "completed" (its documentation) — either way the money is the hotel's.
 */
export const depositCompleted = (status: string | null | undefined) => /^(completed|complete|minted|success|succeeded|successful|paid|settled|credited)$/i.test((status ?? "").trim());
/** A deposit that will never complete (the customer refused, the prompt expired…) — whatever word nTZS uses for it. */
export const depositFailed = (status: string | null | undefined) => !depositCompleted(status) && /fail|reject|cancel|expire|declin|error|revers/i.test(status ?? "");

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

/**
 * "Test connection" (Online payments page): nTZS answers and accepts the hotel's key. Asks for a deposit that does not
 * exist — no money moves; "not found" means the key was accepted.
 */
export async function testNtzsConnection(): Promise<{ ok: true; live: boolean } | { ok: false; error: string }> {
  const res = await call<NtzsDeposit>("GET", "/deposits/connection-check");
  if (res.ok || res.status === 404) return { ok: true, live: ntzsLive() };
  return { ok: false, error: res.error };
}
