import "server-only";
import { db } from "../db";
import { isUniqueViolation } from "../errors";
import { getSettings } from "../settings";
import { sendMessage } from "./messaging";
import type { NotificationDelivery } from "@/generated/prisma/client";

/** Who receives the boss's reports (Settings → Report recipients). */
export interface Recipient { name?: string; phone: string; channel?: string; apiKeyRef?: string | null }

/** At most this many tries per recipient for one report (then only a person's "Send again" tries more). */
export const MAX_ATTEMPTS = 6;

/** How long one run holds a send (the provider waits up to 15 s) before another may try it. */
const LEASE_MS = 60_000;
/** A send is started only with this much time left before the run's deadline (the provider may take 15 s). */
const SEND_WINDOW_MS = 16_000;

/**
 * Send one report's message to every report recipient — the daily report and the shift reports share it. One
 * delivery row per recipient and channel; a recipient already reached for this version is never sent it twice; a
 * failure is recorded (with the provider's answer) and tried again later. Never throws for a failed send.
 * Only one run sends a row at a time (a lease on the row), so the close, the scheduled retry and a person's click
 * can never send the boss the same message twice.
 */
export async function deliverToRecipients(o: {
  /** The report the deliveries belong to. */
  link: { dailyReportId: string } | { shiftReportId: string } | { staffReportId: string };
  purpose: "DAILY_REPORT" | "SHIFT_REPORT" | "STAFF_REPORT";
  text: string;
  /** When this version was made: a send before it was for an earlier version. */
  generatedAt: Date;
  deliveries: NotificationDelivery[];
  /** Send again even to a recipient already reached ("Send again"). */
  force?: boolean;
  /** A person asked (Send / Retry): not held back by the automatic attempts limit. */
  manual?: boolean;
  /** The scheduled run must end by then (its time limit): a send that might not finish is left for the next run. */
  deadline?: number;
}) {
  const settings = await getSettings();
  const recipients = (settings.reportRecipients as unknown as Recipient[]) ?? [];
  const results: { recipient: string; status: string; error?: string }[] = [];

  for (const r of recipients) {
    const channel = r.channel ?? "WHATSAPP_CALLMEBOT";
    let delivery = o.deliveries.find((d) => d.recipient === r.phone && d.channel === channel);
    if (!delivery) {
      try {
        delivery = await db.notificationDelivery.create({ data: { ...o.link, purpose: o.purpose, channel, recipient: r.phone, status: "PENDING" } });
      } catch (e) {
        // Another run made it at the same moment — use that one.
        if (!isUniqueViolation(e)) throw e;
        delivery = await db.notificationDelivery.findFirstOrThrow({ where: { ...o.link, recipient: r.phone, channel } });
      }
    }
    // Sent already for this version of the report → never twice (a regenerated report goes out again).
    const sentThisVersion = delivery.status === "SENT" && delivery.sentAt && delivery.sentAt >= o.generatedAt;
    if (sentThisVersion && !o.force) { results.push({ recipient: r.phone, status: "SENT" }); continue; }
    if (delivery.attempts >= MAX_ATTEMPTS && !o.force && !o.manual) { results.push({ recipient: r.phone, status: "SKIPPED", error: "max attempts" }); continue; }
    if (o.deadline && o.deadline - Date.now() < SEND_WINDOW_MS) { results.push({ recipient: r.phone, status: "SKIPPED", error: "out of time — the next run sends it" }); continue; }
    // Claim this send: only if nobody is sending it now (or that run died), and — unless forced — not sent for this version.
    const now = new Date();
    const claimed = await db.notificationDelivery.updateMany({
      where: {
        id: delivery.id,
        OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - LEASE_MS) } }],
        ...(o.force ? {} : { NOT: { status: "SENT", sentAt: { gte: o.generatedAt } } }),
      },
      data: { attempts: { increment: 1 }, claimedAt: now },
    });
    if (!claimed.count) { results.push({ recipient: r.phone, status: "BUSY" }); continue; }

    const outcome = await sendMessage({ channel, to: r.phone, text: o.text, apiKeyRef: r.apiKeyRef ?? null });
    await db.notificationDelivery.update({
      where: { id: delivery.id },
      data: {
        status: outcome.ok ? "SENT" : "FAILED",
        sentAt: outcome.ok ? new Date() : undefined,
        lastError: outcome.ok ? null : outcome.error?.slice(0, 500),
        providerResponse: outcome.response?.slice(0, 1000) ?? null,
        claimedAt: null,
      },
    });
    results.push({ recipient: r.phone, status: outcome.ok ? "SENT" : "FAILED", error: outcome.error });
  }
  return { recipients: recipients.length, results };
}

/** A send someone is doing right now (shown as "Sending…", no second button). */
export const sendingNow = (d: { claimedAt: Date | null }, now = new Date()) => !!d.claimedAt && now.getTime() - d.claimedAt.getTime() < LEASE_MS;
