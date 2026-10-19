import type { T } from "@/i18n/translate";
import { PageHeader } from "@/components/staff/page-header";
import { AccessPeople, type AccessGroupView } from "./access-people";
import { AddAccountButton, type RoleChoice } from "./add-account-dialog";
import { CustomersPanel } from "./customers-panel";

/**
 * The Access page, drawn: the title and the count, then everyone grouped by role. (The "What the buttons do" cards and the "Safety rules" panel were
 * taken off on 2026-10-19 — the owner knows what the buttons do; the rules are in docs/developer-account.md.) It takes its words (`t`) and its data
 * as they are, so the page and the tests draw exactly the same thing.
 */
export function AccessView({ t, groups, roles = [], count, nowIso, timezone }: { t: T; groups: AccessGroupView[]; roles?: RoleChoice[]; count: number; nowIso: string; timezone: string }) {
  return (
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow={t("Developer console")}
        title={t("Access")}
        actions={<AddAccountButton roles={roles} />}
        description={`${t.plural(count, "{n} account.", "{n} accounts.")} ${t("Pick a person and press Work as to open their dashboard exactly as they see it — without their password. Everything you do is recorded under your name.")}`}
      />

      <AccessPeople groups={groups} nowIso={nowIso} timezone={timezone} />

      <CustomersPanel />
    </div>
  );
}
