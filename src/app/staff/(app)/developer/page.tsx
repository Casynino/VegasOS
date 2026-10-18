import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentSessionTokenHash, getCurrentUser, requestMeta, requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { staffHome } from "@/lib/staff-home";
import { CONSOLE_HREF, developerGreeting } from "@/server/services/developer-console";
import { healthReport } from "@/server/services/developer-health";
import { accessPeople, accountRoleChoices } from "@/server/services/work-as";
import { getT } from "@/i18n/server";
import { AttentionPanel } from "./attention-panel";
import { ConsoleBanner } from "./console-ui";
import { HealthCard } from "./health-card";
import {
  ActivitySection, ConsoleSection, ErrorsSection, GroupLabel, JumpRow, MessagesSection, PeopleSection, ReportsSection, SectionSkeleton, SecuritySection, SettingsSection, SpeedSection,
  type AreaStatus,
  type SectionCtx,
} from "./home-sections";
import { Shortcuts } from "./tabs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Developer console") };
}
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Old links that named a tab (?tab=hotel…) go to that part's place on the one page. */
const OLD_TAB_TO_PART: Record<string, string> = { problems: "problems", crashes: "errors", messages: "messages", speed: "speed", activity: "activity", people: "people", settings: "settings" };

/** Which part of the page each system check belongs to, so a part can say how it is doing in one chip. */
const PART_OF_CHECK: Record<string, string> = {
  "errors-server": "errors", "jobs-overdue": "errors", "jobs-failed": "errors", "webhooks-failing": "errors", "webhooks-silent": "errors", "online-pending": "errors", withdrawals: "errors", "holds-not-released": "errors",
  "deliveries-failed": "messages", "report-daily": "messages", "report-room": "messages", "whatsapp-none": "messages", "whatsapp-keys": "messages",
  "failed-sign-ins": "security", denied: "security", "audit-protected": "security",
  "cron-secret": "settings", "site-address": "settings", "ntzs-off": "settings", "ntzs-webhook": "settings", "payment-account": "settings", migrations: "settings", "migrations-pending": "settings",
  "boss-account": "people", "roles-no-rights": "people",
};

/**
 * THE DEVELOPER HOME (owner, 2026-10-17; ONE PAGE since 2026-10-18; arranged like his other consoles, Target Express and Swift Cargo): the
 * Developer's control room. At the top how healthy the system is and what needs attention; then, one under the other: whether the Boss gets
 * his reports (Messages & reports: the most important to the owner, so it is first), Activity (who is using the system), People & my actions,
 * and the group "The system": errors and automatic jobs, how fast it is, who signed in and who was refused, how it is set up.
 * NOTHING about the hotel's own work (guests, rooms, bookings, orders, money, messages to guests): the Developer's job is the system, not
 * operations. A "business for awareness" group (Hotel, Money, Messages & requests, counts only) was built on 2026-10-18 after his Target
 * console and removed the same day because he said "these are operations data" — they must NOT come back unless the owner asks for them in
 * plain words (the code is in git: commit 2fe4bea). Read-only. Every figure comes from a service in developer-*.ts that checks again that the
 * caller really is the Developer; a part that cannot be read says so and the rest still shows. No password, key or secret is ever read out.
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
  if (oldTab && !str(sp.person).trim() && !str(sp.right).trim() && Object.hasOwn(OLD_TAB_TO_PART, oldTab)) redirect(`${CONSOLE_HREF.home}#${OLD_TAB_TO_PART[oldTab]}`);

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

  const ctx: SectionCtx = { t, user, now, timezone: settings.timezone, when, ipAddress: meta.ipAddress, sessionHash };
  const loading = t("Loading…");
  const person = str(sp.person).trim();
  const right = str(sp.right).trim();
  // One chip on a part's heading: how it is doing, from the system checks that belong to it (none = no chip).
  const chipFor = (part: string | null): AreaStatus | undefined => {
    const mine = part === null ? health.checks : health.checks.filter((c) => PART_OF_CHECK[c.id] === part);
    if (mine.length === 0) return undefined;
    const fix = mine.filter((c) => c.state === "fix").length;
    const look = mine.filter((c) => c.state === "look").length;
    if (fix > 0) return { tone: "bad", text: t("{n} to fix now", { n: fix }) };
    if (look > 0) return { tone: "warn", text: t("{n} to look at", { n: look }) };
    return { tone: "ok", text: t("All fine") };
  };
  const section = (id: string, title: string, hint: string, status: AreaStatus | undefined, body: React.ReactNode) => (
    <ConsoleSection id={id} title={title} hint={hint} status={status}>
      <Suspense fallback={<SectionSkeleton label={loading} />}>{body}</Suspense>
    </ConsoleSection>
  );

  return (
    <div className="w-full space-y-8">
      <div className="space-y-6">
        <ConsoleBanner
          date={t.locale === "en" ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${greeting.today}T00:00:00Z`)) : t.date(greeting.today, true)} tag={t("Developer")} title={hello}
          subtitle={t("Your control room for {hotel} — health, people and everything done, in one place.", { hotel: greeting.hotelName })}
        />
        <Shortcuts t={t} people={people} roles={roles.map((r) => ({ id: r.id, name: r.name }))} />
        <HealthCard t={t} h={health} />
        <AttentionPanel t={t} items={health.items} checks={health.checks} />
      </div>

      {/* The owner (2026-10-18): the Boss's reports are the most important thing to him — right under the attention panel (the look of his ORA console), then a row of pills that jump to every part. */}
      <Suspense fallback={<SectionSkeleton label={loading} />}><ReportsSection ctx={ctx} /></Suspense>
      <JumpRow
        label={t("Jump to")}
        items={[
          { id: "activity", text: t("Activity") }, { id: "people", text: t("People") }, { id: "messages", text: t("Messages & reports") }, { id: "errors", text: t("Errors & jobs") },
          { id: "speed", text: t("Speed & size") }, { id: "security", text: t("Sign-ins & security") }, { id: "settings", text: t("Settings") },
        ]}
      />

      {section("activity", t("Activity"), t("Who is signing in and what the team is doing."), undefined, <ActivitySection ctx={ctx} />)}

      {section("people", t("People & my actions"), t("Who has an account, and what you have done."), chipFor("people"), <PeopleSection ctx={ctx} person={person} right={right} />)}

      <GroupLabel>{t("The system")}</GroupLabel>
      {section("messages", t("Messages & reports"), t("How the sending of the reports and messages went."), chipFor("messages"), <MessagesSection ctx={ctx} />)}
      {section("errors", t("Errors & jobs"), t("Server errors, the automatic jobs and the payment confirmations."), chipFor("errors"), <ErrorsSection ctx={ctx} />)}
      {section("speed", t("Speed & size"), t("How fast the database answers and how the system grows."), health.database.ms !== null ? { tone: health.database.ms >= 500 ? "warn" : "ok", text: t("{ms} ms", { ms: health.database.ms }) } : undefined, <SpeedSection ctx={ctx} checks={health.checks} />)}
      {section("security", t("Sign-ins & security"), t("Wrong passwords, paused sign-ins and what was refused to you."), chipFor("security"), <SecuritySection ctx={ctx} />)}
      {section("settings", t("Settings"), t("How the system is set up."), chipFor("settings"), <SettingsSection ctx={ctx} />)}
    </div>
  );
}
