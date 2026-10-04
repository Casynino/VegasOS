import { revalidatePath } from "next/cache";
import { depositCompleted, depositFailed, readDeposit, verifyNtzsWebhook } from "@/server/services/ntzs";
import { db } from "@/server/db";
import { checkMobilePayment, findMobilePayment, settleMobilePayment } from "@/server/services/mobile-payments";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (...v: unknown[]) => { const x = v.find((y) => typeof y === "string" && y.trim()); return typeof x === "string" ? x.trim() : null; };

/** The event name — `type` (nTZS's documentation), or `event` / `eventType`. */
const eventOf = (b: Obj) => (str(b.type, b.event, b.eventType, b.event_type) ?? "").toLowerCase();
/** "deposit.completed", "deposit.minted", "merchant.sale.completed"… — the money is in. */
const paidEvent = (e: string) => /(^|\.)(completed|complete|minted|succeeded|success|successful|paid|settled)$/.test(e) && !/fail|revers|cancel|refund/.test(e);

/**
 * nTZS calls this when a mobile-money payment moves (`deposit.completed` when the money is minted to the hotel). Genuine
 * only with nTZS's signature (NTZS_WEBHOOK_SECRET). The payment is found by nTZS's deposit id or our own reference,
 * wherever the message carries them. A "paid" event is recorded at once (once — a repeated call changes nothing); any
 * other event about one of our payments makes us ask nTZS for its state, so a payment is never missed because of the
 * shape of a message. What we do is logged (event, ids — never personal details).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyNtzsWebhook(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"))) {
    console.warn("[ntzs] webhook refused: bad or missing signature");
    return new Response("Invalid signature", { status: 401 });
  }
  let body: Obj;
  try { body = obj(JSON.parse(raw)) ?? {}; } catch { return new Response("Bad JSON", { status: 400 }); }

  const event = eventOf(body);
  const data = obj(body.data) ?? obj(body.payload) ?? obj(body.deposit) ?? body;
  const dep = readDeposit(data);
  const endUser = obj(data.endUser) ?? obj(data.end_user);
  const metadata = obj(data.metadata);
  const depositId = str(data.depositId, data.deposit_id, obj(data.deposit)?.id, dep.id);
  const reference = str(data.externalReference, data.external_reference, endUser?.reference, metadata?.reference, metadata?.externalReference);
  const mp = await findMobilePayment({ depositId, reference });
  const log = { event: event || "(none)", keys: Object.keys(body).slice(0, 12), dataKeys: Object.keys(data).slice(0, 20), depositId, status: dep.status || null, matched: mp?.id ?? null };
  if (!mp) {
    console.warn("[ntzs] webhook for a payment we do not know", log);
    return Response.json({ ok: true, ignored: "unknown payment" });
  }

  // Found by our reference on a request nTZS never confirmed: keep its deposit id, so it can be asked about later too.
  if (depositId && !mp.depositId) await db.mobilePayment.updateMany({ where: { id: mp.id, depositId: null }, data: { depositId } }).catch(() => null);

  try {
    // "Paid" by the event's name (deposit.completed…) or by the deposit's own status in the message (minted…).
    if ((paidEvent(event) || depositCompleted(dep.status)) && !depositFailed(dep.status)) {
      const { mp: done, recorded } = await settleMobilePayment(mp.id, { received: dep.amountTzs ?? null, pspReference: dep.pspReference ?? null, source: "webhook" });
      console.info("[ntzs] webhook: paid", { ...log, recorded, now: done.status });
      if (recorded) refresh(done.reservationId);
      return Response.json({ ok: true, recorded });
    }
    // Any other news about one of our payments: ask nTZS for its state (paid → recorded, failed → marked).
    const now = await checkMobilePayment(mp.id, "check");
    console.info("[ntzs] webhook: checked with nTZS", { ...log, now: now.status });
    if (now.status === "COMPLETED") refresh(now.reservationId);
    return Response.json({ ok: true, status: now.status });
  } catch (e) {
    // Not recorded: answer with an error so nTZS tries again (the payment page and the scheduled run also ask).
    console.error("[ntzs] could not record", mp.id, log, e);
    return new Response("Could not record the payment", { status: 500 });
  }
}

function refresh(reservationId: string | null) {
  try {
    revalidatePath("/staff", "layout");
    revalidatePath("/reception/dashboard");
    if (reservationId) revalidatePath(`/staff/reservations/${reservationId}`);
  } catch { /* screens refresh on their own as well */ }
}
