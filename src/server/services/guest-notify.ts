import "server-only";

/**
 * Sending texts to guests and customers, provider-agnostic. Any WhatsApp / SMS
 * gateway (Beem, Africa's Talking, Twilio, a WhatsApp Business relay…) is
 * connected with a webhook — the app never depends on one provider:
 *
 *   GUEST_NOTIFY_WEBHOOK_URL    POST { to, text, event } as JSON
 *   GUEST_NOTIFY_WEBHOOK_TOKEN  optional, sent as "Authorization: Bearer …"
 *
 * Without it, nothing is sent automatically: reception sends the same message
 * in one tap from the order card (and the customer's tracking page updates live).
 */
export function guestNotifyConnected() {
  return !!process.env.GUEST_NOTIFY_WEBHOOK_URL;
}

export async function sendGuestText(req: { to: string; text: string; event: string }): Promise<{ ok: boolean; channel: string; error?: string }> {
  const url = process.env.GUEST_NOTIFY_WEBHOOK_URL;
  if (!url) return { ok: false, channel: "NONE", error: "No messaging provider is connected." };
  try {
    const res = await fetch(url, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", ...(process.env.GUEST_NOTIFY_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.GUEST_NOTIFY_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify(req),
    });
    return res.ok ? { ok: true, channel: "PROVIDER" } : { ok: false, channel: "PROVIDER", error: `Provider answered ${res.status}` };
  } catch (e) {
    return { ok: false, channel: "PROVIDER", error: (e as Error).message };
  }
}
