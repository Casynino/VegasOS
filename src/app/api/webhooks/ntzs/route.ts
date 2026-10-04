import { revalidatePath } from "next/cache";
import { verifyNtzsWebhook } from "@/server/services/ntzs";
import { findMobilePayment, settleMobilePayment } from "@/server/services/mobile-payments";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Payload = {
  type?: string;
  data?: {
    depositId?: string; collectionId?: string; amountTzs?: number; pspReference?: string | null;
    externalReference?: string | null; endUser?: { reference?: string | null } | null;
  };
};

/**
 * nTZS calls this when a mobile-money payment is confirmed (`deposit.completed`, or `merchant.sale.completed` for a
 * merchant wallet). Genuine only with nTZS's signature (NTZS_WEBHOOK_SECRET). The payment is recorded once — a repeated
 * call is answered OK and changes nothing. Anything we cannot match is acknowledged (nothing to do here).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyNtzsWebhook(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let body: Payload;
  try { body = JSON.parse(raw) as Payload; } catch { return new Response("Bad JSON", { status: 400 }); }
  if (body.type !== "deposit.completed" && body.type !== "merchant.sale.completed") return Response.json({ ok: true, ignored: body.type ?? null });

  const d = body.data ?? {};
  const mp = await findMobilePayment({ depositId: d.depositId ?? null, reference: d.externalReference ?? d.endUser?.reference ?? null });
  if (!mp) return Response.json({ ok: true, ignored: "unknown payment" });
  try {
    const { mp: done, recorded } = await settleMobilePayment(mp.id, { received: typeof d.amountTzs === "number" ? d.amountTzs : null, pspReference: d.pspReference ?? null, source: "webhook" });
    if (recorded) {
      revalidatePath("/staff", "layout");
      revalidatePath("/reception/dashboard");
      if (done.reservationId) revalidatePath(`/staff/reservations/${done.reservationId}`);
    }
    return Response.json({ ok: true, recorded });
  } catch (e) {
    // Not recorded: answer with an error so nTZS tries again (the screen and the scheduled run also ask).
    console.error("[ntzs] could not record", mp.id, e);
    return new Response("Could not record the payment", { status: 500 });
  }
}
