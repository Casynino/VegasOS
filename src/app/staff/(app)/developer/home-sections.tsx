import type { ReactNode } from "react";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import type { CurrentUser } from "@/server/auth";
import { inspectPermission, peopleTab, settingsTab, type Inspection } from "@/server/services/developer-console";
import { activityData, crashData, speedData } from "@/server/services/developer-health";
import { noteHomeTabView } from "@/server/services/developer-business";
import { hotelData } from "@/server/services/developer-hotel";
import { messagesData } from "@/server/services/developer-messages";
import { moneyData } from "@/server/services/developer-money";
import { recordError } from "@/server/services/system-events";
import { ActivityTab } from "./tab-activity";
import { CrashesTab } from "./tab-crashes";
import { HotelTab } from "./tab-hotel";
import { MessagesTab } from "./tab-messages";
import { MoneyTab } from "./tab-money";
import { PeopleTab } from "./tab-people";
import { SettingsTab } from "./tab-settings";
import { SpeedTab } from "./tab-speed";

/**
 * The parts of the Developer Home, one under the other (owner, 2026-10-18: "one page — I do not want to be clicking and going up and
 * down"). Each part is its own server component that reads its own figures, so the page can show the top at once and fill the
 * parts in as they are ready (inside <Suspense>); a part that cannot be read says so and the rest of the page is untouched.
 */
export interface SectionCtx {
  t: T;
  user: CurrentUser;
  now: Date;
  timezone: string;
  when: (d: Date) => string;
  ipAddress: string | null;
  sessionHash: string | null;
}

/** One part of the page: an anchor (the jump row goes to it), a heading, one line saying what it is for, and its content. */
export function ConsoleSection({ id, title, hint, badge, children }: { id: string; title: string; hint: string; badge?: { text: string; tone: "ok" | "warn" }; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-32 space-y-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 pb-2.5">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">{title}</h2>
        {badge && (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", badge.tone === "warn" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{badge.text}</span>
        )}
        <p className="basis-full text-sm text-muted-foreground sm:basis-auto">{hint}</p>
      </header>
      {children}
    </section>
  );
}

/** What shows while a part is being read. */
export function SectionSkeleton({ label }: { label: string }) {
  return <div role="status" aria-busy="true" className="h-56 animate-pulse rounded-3xl border border-border/60 bg-card/60"><span className="sr-only">{label}</span></div>;
}

/**
 * A part that cannot be read: said in plain words, and the rest of the page still works. The error itself is not lost: it is written to
 * the system's own error log (the part named in "where"), so the Errors & jobs part shows that a part of this very page is broken.
 */
async function guard(t: T, part: string, run: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await run();
  } catch (error) {
    // Next's own control flow (a redirect, a not-found page) travels as a thrown value: it is not a failure of this part.
    if (typeof (error as { digest?: unknown } | null)?.digest === "string" && /^NEXT_/.test((error as { digest: string }).digest)) throw error;
    console.error(`Developer Home: the "${part}" part could not be read`);
    await recordError({ source: `page:/staff/developer#${part}`, error });
    return <p role="status" className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">{t("This part could not be read just now. The rest of the page is fine.")}</p>;
  }
}

export async function ErrorsSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "errors", async () => <CrashesTab t={ctx.t} c={await crashData(ctx.user, ctx.now)} when={ctx.when} now={ctx.now} />);
}
export async function MessagesSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "messages", async () => {
    await noteHomeTabView(ctx.user, "messages", { ipAddress: ctx.ipAddress, now: ctx.now });
    return <MessagesTab t={ctx.t} d={await messagesData(ctx.user, ctx.now)} when={ctx.when} />;
  });
}
export async function SpeedSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "speed", async () => <SpeedTab t={ctx.t} s={await speedData(ctx.user, ctx.now)} />);
}
export async function ActivitySection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "activity", async () => <ActivityTab t={ctx.t} a={await activityData(ctx.user, ctx.now)} now={ctx.now} timezone={ctx.timezone} />);
}
export async function HotelSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "hotel", async () => {
    await noteHomeTabView(ctx.user, "hotel", { ipAddress: ctx.ipAddress, now: ctx.now });
    return <HotelTab t={ctx.t} h={await hotelData(ctx.user, ctx.now)} when={ctx.when} />;
  });
}
export async function MoneySection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "money", async () => {
    await noteHomeTabView(ctx.user, "money", { ipAddress: ctx.ipAddress, now: ctx.now });
    return <MoneyTab t={ctx.t} m={await moneyData(ctx.user, ctx.now)} when={ctx.when} />;
  });
}
export async function PeopleSection({ ctx, person, right }: { ctx: SectionCtx; person: string; right: string }) {
  return guard(ctx.t, "people", async () => {
    // A look at someone's rights is itself written to the audit trail (by the service).
    const inspection: Inspection | null = person || right ? await inspectPermission(ctx.user, { userId: person, code: right }, { ipAddress: ctx.ipAddress }) : null;
    return <PeopleTab t={ctx.t} data={await peopleTab(ctx.user)} person={person} right={right} inspection={inspection} when={ctx.when} timezone={ctx.timezone} />;
  });
}
export async function SettingsSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "settings", async () => <SettingsTab t={ctx.t} s={await settingsTab(ctx.user, ctx.sessionHash, ctx.now)} when={ctx.when} />);
}
