import "server-only";

/**
 * Messaging providers. The report/notification code only calls
 * `sendMessage`; adding a real SMS gateway (e.g. Beem, Africa's Talking)
 * means adding a provider here — no changes elsewhere.
 *
 * CallMeBot (WhatsApp): each recipient must first send
 * "I allow callmebot to send me messages" to the CallMeBot number to receive an
 * API key. Keys are secrets: stored in server env vars, never in the database.
 *   CALLMEBOT_API_KEY           default key
 *   <apiKeyRef> (e.g. CALLMEBOT_KEY_BOSS)  per-recipient key named in settings
 */

export interface SendRequest { channel: string; to: string; text: string; apiKeyRef?: string | null }
export interface SendOutcome { ok: boolean; error?: string; response?: string }

const TIMEOUT_MS = 15_000;

async function sendCallMeBot(req: SendRequest): Promise<SendOutcome> {
  const key = (req.apiKeyRef && /^[A-Z0-9_]+$/.test(req.apiKeyRef) ? process.env[req.apiKeyRef] : undefined) ?? process.env.CALLMEBOT_API_KEY;
  if (!key) return { ok: false, error: `No CallMeBot API key configured${req.apiKeyRef ? ` (${req.apiKeyRef})` : ""}.` };
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", req.to);
  url.searchParams.set("text", req.text);
  url.searchParams.set("apikey", key);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const body = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // CallMeBot returns 200 with a human-readable page; success text mentions "queued" or "sent".
    const ok = res.ok && /queued|sent|will receive/i.test(body) && !/error|invalid|not allowed/i.test(body);
    return ok ? { ok: true, response: body.slice(0, 300) } : { ok: false, error: `CallMeBot: ${body.slice(0, 200) || res.status}`, response: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: `CallMeBot request failed: ${(e as Error).message}` };
  }
}

export async function sendMessage(req: SendRequest): Promise<SendOutcome> {
  if (!/^\+\d{9,15}$/.test(req.to)) return { ok: false, error: "Recipient must be an international number like +255…" };
  switch (req.channel) {
    case "WHATSAPP_CALLMEBOT":
      return sendCallMeBot(req);
    default:
      return { ok: false, error: `Unsupported channel ${req.channel}` };
  }
}
