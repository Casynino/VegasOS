import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { getT } from "@/i18n/server";
import { AccessView } from "./access-view";
import { loadAccessPage } from "./data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Access") };
}
export const dynamic = "force-dynamic";

/**
 * ACCESS — the Developer console's page for people: pick someone and "Work as" (their own dashboard, their rights minus every money
 * right, everything recorded under the Developer's name), Suspend, Re-activate or Sign out everywhere. Developer only; the rules are in
 * server/services/work-as.ts and are checked again on the server for every button.
 */
export default async function AccessPage() {
  const { groups, count, roles } = await loadAccessPage();
  const [t, settings] = await Promise.all([getT(), getSettings()]);
  return <AccessView t={t} groups={groups} roles={roles} count={count} nowIso={new Date().toISOString()} timezone={settings.timezone} />;
}
