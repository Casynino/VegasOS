import { Info } from "lucide-react";
import type { T } from "@/i18n/translate";
import { LOGIN_LIMITS, type CrashData } from "@/server/services/developer-health";
import { FAILED_SIGN_IN_ROWS_PER_HOUR } from "@/server/services/auth-login";
import type { DeniedEntry } from "@/server/services/developer-console";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, RankBars } from "./console-charts";
import { dayLabel, num, Quiet, StatBlock } from "./console-ui";

/** CRASHES & SIGN-INS: this system has no crash tracking (said plainly), failed sign-ins, paused sign-ins and what was refused to the Developer. */

const FAILED = "#d95926";

export function DeniedPanel({ t, rows, when }: { t: T; rows: DeniedEntry[]; when: (x: Date) => string }) {
  return (
    <Panel title={t("Refused to you")} subtitle={t("The last {n} times a page or an action was refused to a Developer account.", { n: 20 })}>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{t("Nothing was refused to a Developer account.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-stack className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-2 pr-4 font-medium">{t("When")}</th><th className="py-2 pr-4 font-medium">{t("Who")}</th>
                <th className="py-2 pr-4 font-medium">{t("What was refused")}</th><th className="py-2 font-medium">{t("The right it needs")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2.5 pr-4 whitespace-nowrap">{when(r.at)}</td>
                  <td className="py-2.5 pr-4">{r.who}</td>
                  <td className="py-2.5 pr-4">
                    {r.kind ? (r.kind === "page" ? t("A page") : t("An action")) : "—"}
                    {r.path && <span className="block break-all font-mono text-[11px] text-muted-foreground">{r.path}</span>}
                  </td>
                  <td className="py-2.5">
                    {r.needs.length === 0 ? "—" : r.needs.map((n) => (
                      <span key={n.code} className="block min-w-0 leading-snug">
                        <span className="font-mono text-xs">{n.code}</span>
                        {n.description && <span className="block text-xs text-muted-foreground">{t(n.description)}</span>}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function CrashesTab({ t, c, when }: { t: T; c: CrashData; when: (x: Date) => string }) {
  const f = c.failed;
  const paused = c.paused ? c.paused.developer + c.paused.staff : null;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-300"><Info className="size-[18px]" aria-hidden /></span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{t("Error tracking is not part of this system")}</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">{t("A crash on the server is not collected here. To see one, open the hosting provider's logs (Vercel → Logs) and look at the time it happened. What this tab can show is sign-in trouble and what was refused to the Developer.")}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatBlock
          label={t("Failed sign-ins")} value={num(t, f?.last24h)} caption={t("wrong tries in 24 hours")} warn={!!f?.last24h}
          tag={f?.last24h ? t("Look at it") : t("Quiet")} tagTone={f?.last24h ? "amber" : "emerald"}
          note={t("A wrong password, or an account that is switched off. Nobody was signed in. Only real accounts are written down — an email nobody holds is not. At most {n} tries for one account are written down each hour; if there are more, one line says so and this number is lower than the real tries.", { n: FAILED_SIGN_IN_ROWS_PER_HOUR })}
        />
        <StatBlock label={t("Failed sign-ins")} value={num(t, f?.last7d)} caption={t("wrong tries in 7 days")} tag={t("Week")} tagTone="slate" note={t("A few typing mistakes are normal. A steady stream on one account is not.")} />
        <StatBlock
          label={t("Paused right now")} value={num(t, paused)} caption={t("sign-in places or emails")} warn={!!paused}
          tag={paused ? t("Look at it") : t("None")} tagTone={paused ? "amber" : "emerald"}
          note={t("After {dev} wrong tries in {minutes} minutes a Developer sign-in is paused for the rest of that time ({staff} for staff). Counts only — an email or an address is never shown. While a Developer sign-in is paused, the sign-in page gives the same answer as for any wrong password, so it does not tell anyone which email is a Developer's.", { dev: LOGIN_LIMITS.developerEmail, minutes: LOGIN_LIMITS.windowMinutes, staff: LOGIN_LIMITS.staffEmail })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={t("Failed sign-ins per day")} subtitle={t("The last 7 days. Hover a bar for exact numbers; the table below has them all.")}>
          {f
            ? <BarChart t={t} caption={t("Failed sign-ins per day")} empty={t("No failed sign-ins in the last 7 days.")} series={[{ key: "count", label: t("Failed sign-ins"), color: FAILED }]}
                columns={f.byDay.map((d, i, all) => ({ key: d.date, tick: dayLabel(t, d.date), name: dayLabel(t, d.date), values: { count: d.count }, emphasise: i === all.length - 1 }))} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
        <Panel title={t("Accounts most often tried")} subtitle={t("Failed tries by account, last 7 days.")}>
          {f
            ? <RankBars t={t} rows={f.byAccount.map((a) => ({ key: a.name, label: a.name, value: a.count }))} color={FAILED} caption={t("Accounts most often tried")} empty={t("No account was tried wrongly in the last 7 days.")} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
      </div>

      <DeniedPanel t={t} rows={c.denied} when={when} />
    </div>
  );
}
