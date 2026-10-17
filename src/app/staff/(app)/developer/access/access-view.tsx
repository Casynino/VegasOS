import type { ReactNode } from "react";
import { LogIn, LogOut, ShieldCheck, UserX } from "lucide-react";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/staff/page-header";
import { AccessPeople, type AccessGroupView } from "./access-people";

/**
 * The Access page, drawn: the title and the count, "What the buttons do", the safety rules, and everyone grouped by role. It takes its
 * words (`t`) and its data as they are, so the page and the tests draw exactly the same thing.
 */
export function AccessView({ t, groups, count, nowIso, timezone }: { t: T; groups: AccessGroupView[]; count: number; nowIso: string; timezone: string }) {
  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow={t("Developer console")}
        title={t("Access")}
        description={`${t.plural(count, "{n} account.", "{n} accounts.")} ${t("Pick a person and press Work as to open their dashboard exactly as they see it — without their password. Everything you do is recorded under your name.")}`}
      />

      <section aria-labelledby="what-buttons-do" className="space-y-3">
        <h2 id="what-buttons-do" className="text-base font-semibold">{t("What the buttons do")}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <GuideCard
            icon={<LogIn />} tone="gold" title={t("Work as")}
            text={t("Opens that person's dashboard with their real permissions and data. A bar at the top shows who you are working as; press Stop to come back here. It ends by itself after 4 hours. Money is never touched: payments, revenue, expenses, withdrawals and purchases are refused while you work as someone.")}
          />
          <GuideCard
            icon={<UserX />} tone="amber" title={t("Suspend")}
            text={t("Blocks the account and signs the person out until it is re-activated. You must write a reason and type CONFIRM. You can only re-activate accounts you suspended yourself.")}
          />
          <GuideCard
            icon={<LogOut />} tone="plain" title={t("Sign out everywhere")}
            text={t("Ends every open session on every phone and computer. The person can sign straight back in — useful if a phone was lost.")}
          />
        </div>
      </section>

      <section aria-labelledby="safety-rules" className="flex items-start gap-3 rounded-3xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 sm:gap-4 sm:p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 [&_svg]:size-5"><ShieldCheck aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="safety-rules" className="text-base font-semibold">{t("Safety rules while working as someone")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("You can't change passwords or login emails, create accounts, change roles or rights, suspend people or sign people out of all devices while working as them — so Work as can never be used to take over an account. Money stays untouchable too. The Boss is told every time you start.")}
          </p>
        </div>
      </section>

      <AccessPeople groups={groups} nowIso={nowIso} timezone={timezone} />
    </div>
  );
}

const TONES = {
  gold: { card: "border-[oklch(0.72_0.12_80/0.35)] bg-[oklch(0.72_0.12_80/0.07)]", tile: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.5_0.11_75)] dark:text-[#f0cf86]" },
  amber: { card: "border-amber-500/30 bg-amber-500/[0.06]", tile: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  plain: { card: "border-border/70 bg-card", tile: "bg-muted text-muted-foreground" },
} as const;

function GuideCard({ icon, tone, title, text }: { icon: ReactNode; tone: keyof typeof TONES; title: string; text: string }) {
  const c = TONES[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-3xl border p-4 sm:p-5", c.card)}>
      <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-2xl [&_svg]:size-5", c.tile)}>{icon}</span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
