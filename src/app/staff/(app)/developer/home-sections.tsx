import type { ReactNode } from "react";
import type { T } from "@/i18n/translate";
import type { CurrentUser } from "@/server/auth";
import { inspectPermission, peopleTab, settingsTab, type Inspection } from "@/server/services/developer-console";
import type { CheckResult } from "@/server/services/developer-checks";
import { activityData } from "@/server/services/developer-activity";
import { crashData, speedData } from "@/server/services/developer-health";
import { noteHomeTabView } from "@/server/services/developer-business";
import { messagesData } from "@/server/services/developer-messages";
import { teamData } from "@/server/services/developer-team";
import { recordError } from "@/server/services/system-events";
import { ErrorsTab, SecurityTab } from "./tab-crashes";
import { Tag, type TagTone } from "./console-ui";
import { ActivityTab } from "./tab-activity";
import { MessagesTab } from "./tab-messages";
import { PeopleTab } from "./tab-people";
import { SettingsTab } from "./tab-settings";
import { SpeedTab } from "./tab-speed";

/**
 * The parts of the Developer Home, one under the other (owner, 2026-10-18: one page, easy to read — "I do not want to be clicking and going
 * up and down", then "bad arrangement" when it was long and repeated itself). Each part is its own server component that reads its own figures, so the page can show the top at once and fill the
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

/** How one part is doing, in one small chip next to its heading. */
export interface AreaStatus { tone: "ok" | "warn" | "bad" | "quiet"; text: string }
const STATUS_TONE: Record<AreaStatus["tone"], TagTone> = { ok: "emerald", warn: "amber", bad: "rose", quiet: "slate" };

/**
 * One part of the page, always open (owner, 2026-10-18: "one page, nice arrangement, I do not want to be clicking"): a heading with one short
 * line saying what it is for and one chip saying how it is doing, then its content. The anchor is on the section so a link such as "#errors" goes to it.
 */
export function ConsoleSection({ id, title, hint, status, children }: { id: string; title: string; hint: string; status?: AreaStatus; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 pb-3">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2>
        {status && <Tag tone={STATUS_TONE[status.tone]}>{status.text}</Tag>}
        <p className="basis-full text-sm text-muted-foreground sm:basis-auto">{hint}</p>
      </header>
      {children}
    </section>
  );
}

/** A small pill and a line between groups of parts ("The system"), so the page reads in blocks. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 pt-2" role="presentation">
      <span className="rounded-full bg-muted px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/80">{children}</span>
      <span className="h-px flex-1 bg-border/70" aria-hidden />
    </div>
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
  return guard(ctx.t, "errors", async () => <ErrorsTab t={ctx.t} c={await crashData(ctx.user, ctx.now)} when={ctx.when} now={ctx.now} />);
}
export async function SecuritySection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "security", async () => <SecurityTab t={ctx.t} c={await crashData(ctx.user, ctx.now)} when={ctx.when} now={ctx.now} />);
}
export async function MessagesSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "messages", async () => {
    await noteHomeTabView(ctx.user, "messages", { ipAddress: ctx.ipAddress, now: ctx.now });
    return <MessagesTab t={ctx.t} d={await messagesData(ctx.user, ctx.now)} when={ctx.when} />;
  });
}
export async function SpeedSection({ ctx, checks }: { ctx: SectionCtx; checks: CheckResult[] }) {
  return guard(ctx.t, "speed", async () => <SpeedTab t={ctx.t} s={await speedData(ctx.user, ctx.now)} dataChecks={checks.filter((c) => c.group === "Data")} />);
}
export async function ActivitySection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "activity", async () => <ActivityTab t={ctx.t} a={await activityData(ctx.user, ctx.now)} now={ctx.now} timezone={ctx.timezone} />);
}
export async function PeopleSection({ ctx, person, right }: { ctx: SectionCtx; person: string; right: string }) {
  return guard(ctx.t, "people", async () => {
    // A look at someone's rights is itself written to the audit trail (by the service).
    const inspection: Inspection | null = person || right ? await inspectPermission(ctx.user, { userId: person, code: right }, { ipAddress: ctx.ipAddress }) : null;
    const [data, team] = await Promise.all([peopleTab(ctx.user), teamData(ctx.user, ctx.now)]);
    return <PeopleTab t={ctx.t} data={data} team={team} now={ctx.now} person={person} right={right} inspection={inspection} when={ctx.when} timezone={ctx.timezone} />;
  });
}
export async function SettingsSection({ ctx }: { ctx: SectionCtx }) {
  return guard(ctx.t, "settings", async () => <SettingsTab t={ctx.t} s={await settingsTab(ctx.user, ctx.sessionHash, ctx.now)} when={ctx.when} />);
}
