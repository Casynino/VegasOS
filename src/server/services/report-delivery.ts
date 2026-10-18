import "server-only";
import { after } from "next/server";
import { db } from "../db";
import { isUniqueViolation } from "../errors";
import { getSettings } from "../settings";
import { sendMessage } from "./messaging";
import type { HotelSettings, NotificationDelivery } from "@/generated/prisma/client";
import { getTFor } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { DEFAULT_LOCALE, LOCALE_META, toLocale, type Locale } from "@/i18n/config";
import { keepLink } from "@/lib/wa-fit";

/** Who receives the boss's reports (Settings → Report recipients). */
export interface Recipient {
  name?: string; phone: string; channel?: string; apiKeyRef?: string | null;
  /** The language their reports come in (English when not set). */
  lang?: Locale | null;
}

/** A report link that opens in the reader's language (?lang=zh — the report pages follow it). */
export const withLang = (url: string, lang: Locale) => (lang === DEFAULT_LOCALE ? url : `${url}${url.includes("?") ? "&" : "?"}lang=${LOCALE_META[lang].segment}`);

/** A recipient's language (English when not set or unknown). */
export const recipientLang = (r: { lang?: string | null }): Locale => toLocale(r.lang) ?? DEFAULT_LOCALE;

/** How a notice to the boss went: how many people it was meant for, how many were told, how many were not. */
export interface BossNotice { recipients: number; told: number; failed: number }

/**
 * A short notice to the boss (every report recipient) about something that just happened — not a report: the caller
 * sends it once, after the action is saved. Written in each reader's language. Never throws: a notice that could not
 * be sent is only logged, the action it tells about stays done. It says how many recipients were told (`told`), so a caller
 * that must leave a trace of it (a Developer starting "Work as") can write it down.
 */
export async function tellBoss(textFor: (t: T, settings: HotelSettings) => string): Promise<BossNotice> {
  const result: BossNotice = { recipients: 0, told: 0, failed: 0 };
  try {
    const settings = await getSettings();
    const recipients = (settings.reportRecipients as unknown as Recipient[]) ?? [];
    result.recipients = recipients.length;
    for (const r of recipients) {
      const sent = await sendMessage({ channel: r.channel ?? "WHATSAPP_CALLMEBOT", to: r.phone, text: textFor(await getTFor(recipientLang(r)), settings), apiKeyRef: r.apiKeyRef });
      if (sent.ok) result.told++;
      else console.error("[boss notice] not sent to", r.name ?? "a recipient", sent.error);
    }
  } catch (e) {
    console.error("[boss notice]", e);
  }
  // Whoever was not reached (a failed send, or the run stopped early) counts as not told.
  result.failed = result.recipients - result.told;
  return result;
}

/**
 * The same once the answer has gone out (never delays the desk); straight away where there is no request (a job, a test).
 * `then` is told how the notice went, when it is over (it must never throw; a failure in it is only logged).
 */
export function tellBossSoon(textFor: Parameters<typeof tellBoss>[0], then?: (result: BossNotice) => void | Promise<void>) {
  const run = async () => {
    const result = await tellBoss(textFor);
    if (then) {
      try { await then(result); } catch (e) { console.error("[boss notice] follow-up failed", e); }
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

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
  purpose: "DAILY_REPORT" | "SHIFT_REPORT" | "STAFF_REPORT" | "ROOM_REPORT";
  /** The message in English (as kept with the report). */
  text: string;
  /**
   * The same message in another language — rendered from the same report, so the numbers are the same. Made once per
   * language per send (only when a recipient reads that language); English recipients get `text`.
   */
  textFor?: (lang: Locale) => Promise<string> | string;
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
  const results: { recipient: string; status: string; error?: string; response?: string; already?: boolean; at?: Date | null }[] = [];
  const texts = new Map<Locale, Promise<string>>();
  const textOf = (lang: Locale) => {
    if (lang === DEFAULT_LOCALE || !o.textFor) return Promise.resolve(o.text);
    if (!texts.has(lang)) {
      // A message that cannot be written in their language still goes out (in English) — the report always reaches them.
      texts.set(lang, Promise.resolve().then(() => o.textFor!(lang)).catch((e) => { console.error("[report-delivery] could not write the message in", lang, e); return o.text; }));
    }
    return texts.get(lang)!;
  };

  for (const r of recipients) {
    const channel = r.channel ?? "WHATSAPP_CALLMEBOT";
    let delivery = o.deliveries.find((d) => d.recipient === r.phone && d.channel === channel);
    if (!delivery) {
      try {
        delivery = await db.notificationDelivery.create({ data: { ...o.link, purpose: o.purpose, channel, recipient: r.phone, status: "PENDING" } });
      } catch (e) {
        // Another run made it at the same moment — use that one.
        if (!isUniqueViolation(e)) throw e;
        delivery = await db.notificationDelivery.findFirstOrThrow({ where: { ...o.link, recipient: r.phone, channel, purpose: o.purpose } });
      }
    }
    // Sent already for this version of the report → never twice (a regenerated report goes out again).
    const sentThisVersion = delivery.status === "SENT" && delivery.sentAt && delivery.sentAt >= o.generatedAt;
    if (sentThisVersion && !o.force) { results.push({ recipient: r.phone, status: "SENT", already: true, at: delivery.sentAt, response: delivery.providerResponse ?? undefined }); continue; }
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

    // The last check: a text the provider would cut is shortened here — its link always arrives.
    const outcome = await sendMessage({ channel, to: r.phone, text: keepLink(await textOf(recipientLang(r))), apiKeyRef: r.apiKeyRef ?? null });
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
    results.push({ recipient: r.phone, status: outcome.ok ? "SENT" : "FAILED", error: outcome.error, response: outcome.response });
  }
  return { recipients: recipients.length, results };
}

/** A send someone is doing right now (shown as "Sending…", no second button). */
export const sendingNow = (d: { claimedAt: Date | null }, now = new Date()) => !!d.claimedAt && now.getTime() - d.claimedAt.getTime() < LEASE_MS;
