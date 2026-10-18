import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Activity, BedDouble, Bug, Gauge, Send, Settings2, ShieldAlert, Users, Wallet } from "lucide-react";
import { currentSessionTokenHash, getCurrentUser, requestMeta, requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { staffHome } from "@/lib/staff-home";
import { CONSOLE_HREF, developerGreeting, parseTab } from "@/server/services/developer-console";
import { healthReport } from "@/server/services/developer-health";
import { accessPeople, accountRoleChoices } from "@/server/services/work-as";
import { getT } from "@/i18n/server";
import { JumpNav } from "@/components/dashboard/finance-panels";
import { AttentionSection } from "./attention";
import { ConsoleBanner } from "./console-ui";
import { HealthCard } from "./health-card";
import {
  ActivitySection, ConsoleSection, ErrorsSection, HotelSection, MessagesSection, MoneySection, PeopleSection, SectionSkeleton, SettingsSection, SpeedSection,
  type SectionCtx,
} from "./home-sections";
import { Shortcuts } from "./tabs";
import { ProblemsTab } from "./tab-problems";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Developer console") };
}
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Old links that named a tab (?tab=hotel…) go to that part's place on the one page. */
const OLD_TAB_TO_PART: Record<string, string> = { problems: "problems", crashes: "errors", messages: "messages", speed: "speed", activity: "activity", hotel: "hotel", money: "money", people: "people", settings: "settings" };

/**
 * THE DEVELOPER HOME (owner, 2026-10-17; ONE PAGE since 2026-10-18): the Developer's control room. At the top how healthy the system is and
 * what needs attention; then, one under the other and reached from a "Jump to" row that stays in view, every part: the system's problems,
 * errors and automatic jobs, whether the Boss gets his reports, how fast it is, who is using it, what is happening in the hotel, where the
 * money is, what anyone may do, and how it is set up. Read-only. Every figure comes from a service in developer-*.ts that checks again that
 * the caller really is the Developer; a part that cannot be read says so and the rest still shows. No password, key or secret is ever read out.
 * The console and the "work as" world are kept apart: someone working as another person is sent to that person's home.
 */
export default async function DeveloperHomePage({ searchParams }: PageProps<"/staff/developer">) {
  const current = await getCurrentUser();
  if (current?.workAs) redirect(staffHome(current.permissions));
  const user = await requirePagePermission("developer.access");

  const now = new Date();
  const sp = await searchParams;
  const oldTab = str(Array.isArray(sp.tab) ? sp.tab[0] : sp.tab);
  // An old bookmark that named a tab goes to its place on the page (not when it carries a person or a right: that is the "Who can do what" form).
  if (oldTab && !str(sp.person).trim() && !str(sp.right).trim() && OLD_TAB_TO_PART[oldTab] && parseTab(oldTab) === oldTab) redirect(`${CONSOLE_HREF.home}#${OLD_TAB_TO_PART[oldTab]}`);

  const [t, settings, sessionHash, meta] = await Promise.all([getT(), getSettings(), currentSessionTokenHash(), requestMeta()]);
  const when = (d: Date) => t.dateTime(d, settings.timezone);
  const [greeting, health, groups, roles] = await Promise.all([developerGreeting(user, now), healthReport(user, now), accessPeople(user), accountRoleChoices(user)]);
  // The people the "Work as" popup lists: everyone the Developer can work as, with their role.
  const people = groups.flatMap((g) => g.people.filter((p) => p.canWorkAs).map((p) => ({ id: p.id, fullName: p.fullName, roleName: g.roleName })));

  const hello = {
    morning: t("Good morning, {name}.", { name: greeting.firstName }),
    afternoon: t("Good afternoon, {name}.", { name: greeting.firstName }),
    evening: t("Good evening, {name}.", { name: greeting.firstName }),
  }[greeting.partOfDay];

  const problems = health.checks.filter((c) => c.state === "fix" || c.state === "look").length;
  const ctx: SectionCtx = { t, user, now, timezone: settings.timezone, when, ipAddress: meta.ipAddress, sessionHash };
  const loading = t("Loading…");
  const person = str(sp.person).trim();
  const right = str(sp.right).trim();
  const icon = "size-3.5";
  const parts = [
    { id: "problems", label: t("Problems"), icon: <ShieldAlert className={icon} aria-hidden /> },
    { id: "errors", label: t("Errors & jobs"), icon: <Bug className={icon} aria-hidden /> },
    { id: "messages", label: t("Messages & reports"), icon: <Send className={icon} aria-hidden /> },
    { id: "speed", label: t("Speed & size"), icon: <Gauge className={icon} aria-hidden /> },
    { id: "activity", label: t("Activity"), icon: <Activity className={icon} aria-hidden /> },
    { id: "hotel", label: t("Hotel"), icon: <BedDouble className={icon} aria-hidden /> },
    { id: "money", label: t("Money"), icon: <Wallet className={icon} aria-hidden /> },
    { id: "people", label: t("People & my actions"), icon: <Users className={icon} aria-hidden /> },
    { id: "settings", label: t("Settings"), icon: <Settings2 className={icon} aria-hidden /> },
  ];

  return (
    <div className="w-full space-y-6">
      <ConsoleBanner
        date={t.date(greeting.today, true)} tag={t("Developer")} title={hello}
        subtitle={t("Your control room for {hotel} — health, people and everything done, in one place.", { hotel: greeting.hotelName })}
      />
      <Shortcuts t={t} people={people} roles={roles.map((r) => ({ id: r.id, name: r.name }))} />
      <HealthCard t={t} h={health} />
      <AttentionSection t={t} items={health.items} />

      {/* "Jump to": every part is on this page, one under the other — this row stays in view and goes to any of them. */}
      <div className="sticky top-[4.75rem] z-20 -mx-1 bg-background/90 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <JumpNav label={t("Jump to")} items={parts} />
      </div>

      <ConsoleSection id="problems" title={t("Problems")} hint={t("What is wrong in the system and what to fix.")} badge={problems > 0 ? { text: String(problems), tone: "warn" } : undefined}>
        <ProblemsTab t={t} checks={health.checks} />
      </ConsoleSection>
      <ConsoleSection id="errors" title={t("Errors & jobs")} hint={t("Server errors, the automatic jobs and the payment confirmations.")} badge={health.serverErrors24h ? { text: String(health.serverErrors24h), tone: "warn" } : health.failedSignIns24h ? { text: String(health.failedSignIns24h), tone: "warn" } : undefined}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><ErrorsSection ctx={ctx} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="messages" title={t("Messages & reports")} hint={t("Is the Boss getting his reports and messages?")}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><MessagesSection ctx={ctx} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="speed" title={t("Speed & size")} hint={t("How fast the database answers and how the system grows.")} badge={health.database.ms !== null ? { text: t("{ms} ms", { ms: health.database.ms }), tone: health.database.ms >= 500 ? "warn" : "ok" } : undefined}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><SpeedSection ctx={ctx} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="activity" title={t("Activity")} hint={t("Who is using the system.")}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><ActivitySection ctx={ctx} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="hotel" title={t("Hotel")} hint={t("What is happening in the hotel — to understand, not to do (read-only).")}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><HotelSection ctx={ctx} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="money" title={t("Money")} hint={t("Where the money is — to understand, not to do (read-only).")}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><MoneySection ctx={ctx} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="people" title={t("People & my actions")} hint={t("What anyone may do, and what you did.")}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><PeopleSection ctx={ctx} person={person} right={right} /></Suspense>
      </ConsoleSection>
      <ConsoleSection id="settings" title={t("Settings")} hint={t("How the system is set up.")}>
        <Suspense fallback={<SectionSkeleton label={loading} />}><SettingsSection ctx={ctx} /></Suspense>
      </ConsoleSection>
    </div>
  );
}
