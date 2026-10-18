import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentSessionTokenHash, getCurrentUser, requestMeta, requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { staffHome } from "@/lib/staff-home";
import {
  developerGreeting, inspectPermission, parseTab, peopleTab, settingsTab, type ConsoleTab, type Inspection,
} from "@/server/services/developer-console";
import { activityData, crashData, healthReport, speedData } from "@/server/services/developer-health";
import { accessPeople, accountRoleChoices } from "@/server/services/work-as";
import { getT } from "@/i18n/server";
import { AttentionSection } from "./attention";
import { ConsoleBanner } from "./console-ui";
import { HealthCard } from "./health-card";
import { TabNav, Shortcuts, type TabBadge } from "./tabs";
import { ActivityTab } from "./tab-activity";
import { CrashesTab } from "./tab-crashes";
import { PeopleTab } from "./tab-people";
import { SettingsTab } from "./tab-settings";
import { SpeedTab } from "./tab-speed";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Developer console") };
}
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * THE DEVELOPER HOME (owner, 2026-10-17): the Developer's control room — how healthy the system is, what needs attention, and
 * (under the tabs) who is using it, how fast it is, who failed to sign in, how it is set up, and what the Developer has done.
 * Read-only. Every figure comes from a service in developer-console.ts / developer-health.ts, which checks again that the caller
 * really is the Developer; a part that cannot be read is left out and the rest still shows. No password, key or secret is ever read out.
 * The console and the "work as" world are kept apart: someone working as another person is sent to that person's home.
 */
export default async function DeveloperHomePage({ searchParams }: PageProps<"/staff/developer">) {
  const current = await getCurrentUser();
  if (current?.workAs) redirect(staffHome(current.permissions));
  const user = await requirePagePermission("developer.access");

  const now = new Date();
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const [t, settings, sessionHash, meta] = await Promise.all([getT(), getSettings(), currentSessionTokenHash(), requestMeta()]);
  const when = (d: Date) => t.dateTime(d, settings.timezone);
  const [greeting, health, groups, roles] = await Promise.all([developerGreeting(user, now), healthReport(user, now), accessPeople(user), accountRoleChoices(user)]);
  // The people the "Work as someone" popup lists: everyone the Developer can work as, with their role.
  const people = groups.flatMap((g) => g.people.filter((p) => p.canWorkAs).map((p) => ({ id: p.id, fullName: p.fullName, roleName: g.roleName })));

  const hello = {
    morning: t("Good morning, {name}.", { name: greeting.firstName }),
    afternoon: t("Good afternoon, {name}.", { name: greeting.firstName }),
    evening: t("Good evening, {name}.", { name: greeting.firstName }),
  }[greeting.partOfDay];

  const badges: Partial<Record<ConsoleTab, TabBadge>> = {};
  if (health.database.ms !== null) badges.speed = { text: t("{ms} ms", { ms: health.database.ms }), tone: health.database.ms >= 500 ? "warn" : "ok" };
  if (health.failedSignIns24h) badges.crashes = { text: String(health.failedSignIns24h), tone: "warn" };

  let body: ReactNode;
  if (tab === "activity") {
    body = <ActivityTab t={t} a={await activityData(user, now)} now={now} timezone={settings.timezone} />;
  } else if (tab === "speed") {
    body = <SpeedTab t={t} s={await speedData(user, now)} />;
  } else if (tab === "crashes") {
    body = <CrashesTab t={t} c={await crashData(user, now)} when={when} />;
  } else if (tab === "settings") {
    body = <SettingsTab t={t} s={await settingsTab(user, sessionHash, now)} when={when} />;
  } else {
    const person = str(sp.person).trim();
    const right = str(sp.right).trim();
    // A look at someone's rights is itself written to the audit trail (by the service).
    const inspection: Inspection | null = person || right ? await inspectPermission(user, { userId: person, code: right }, { ipAddress: meta.ipAddress }) : null;
    body = <PeopleTab t={t} data={await peopleTab(user)} person={person} right={right} inspection={inspection} when={when} timezone={settings.timezone} />;
  }

  return (
    <div className="w-full space-y-6">
      <ConsoleBanner
        date={t.date(greeting.today, true)} tag={t("Developer")} title={hello}
        subtitle={t("Your control room for {hotel} — health, people and everything done, in one place.", { hotel: greeting.hotelName })}
      />
      <Shortcuts t={t} people={people} roles={roles.map((r) => ({ id: r.id, name: r.name }))} />
      <HealthCard t={t} h={health} />
      <AttentionSection t={t} items={health.items} />
      <div className="space-y-4">
        <TabNav t={t} active={tab} badges={badges} />
        {body}
      </div>
    </div>
  );
}
