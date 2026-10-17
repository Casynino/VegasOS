import type { T } from "@/i18n/translate";
import type { SpeedData } from "@/server/services/developer-health";
import { Panel } from "@/components/dashboard/kit";
import { bytesText, num, Quiet, StatBlock } from "./console-ui";

/** SPEED & SIZE: how fast the database answers, how big it is, how many rows the biggest tables hold, which version is running. */

/** Under this many milliseconds the database is quick; over the second one it is slow. */
const QUICK_MS = 100;
const SLOW_MS = 500;

export function SpeedTab({ t, s }: { t: T; s: SpeedData }) {
  const avg = s.latency.average;
  const tone = avg === null ? "rose" : avg < QUICK_MS ? "emerald" : avg < SLOW_MS ? "amber" : "rose";
  const word = avg === null ? t("No answer") : avg < QUICK_MS ? t("Quick") : avg < SLOW_MS ? t("A little slow") : t("Slow");
  const maxRows = Math.max(1, ...s.tables.map((x) => x.rows ?? 0));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatBlock
          label={t("Database answer time")} value={avg === null ? "—" : t("{ms} ms", { ms: avg })} caption={s.latency.samples.length ? t("average of {n} quick questions", { n: s.latency.samples.length }) : t("the database did not answer")}
          tag={word} tagTone={tone} warn={tone !== "emerald"}
          note={s.latency.samples.length
            ? t("The answers took {list}. Under {quick} ms is quick; over {slow} ms is slow.", { list: s.latency.samples.map((n) => `${n} ms`).join(" · "), quick: QUICK_MS, slow: SLOW_MS })
            : t("Staff cannot work until the database answers again.")}
        />
        <StatBlock
          label={t("Database size")} value={bytesText(t, s.databaseBytes)} caption={t("everything the hotel has saved")}
          tag={t("Storage")} tagTone="sky"
          note={t("It grows with every booking, payment and audit entry. The biggest tables are listed below.")}
        />
        <StatBlock
          label={t("Running version")} value={s.deployment.commit ?? "—"} caption={s.deployment.environment ? t("Environment: {name}", { name: s.deployment.environment }) : t("environment not known")}
          tag={t("Deployment")} tagTone="gold"
          note={s.deployment.commit ? t("The short code of the change this server is running — the one to give when you report a problem.") : t("The hosting provider did not give the version, so it is not known here.")}
        />
      </div>

      <Panel title={t("The biggest tables")} subtitle={t("Rows held and room taken. These are counts only — no record is read.")}>
        <div className="overflow-x-auto">
          <table data-stack className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-2 pr-4 font-medium">{t("Kind of record")}</th><th className="py-2 pr-4 text-right font-medium">{t("Rows")}</th><th className="py-2 pr-4 font-medium"><span className="sr-only">{t("Share of the biggest")}</span></th><th className="py-2 text-right font-medium">{t("Space used")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {s.tables.map((x) => (
                <tr key={x.label} className="align-middle">
                  <td className="py-2.5 pr-4 font-medium">{t(x.label)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{num(t, x.rows)}</td>
                  <td className="w-1/3 py-2.5 pr-4" aria-hidden>{x.rows !== null && <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(2, (x.rows / maxRows) * 100)}%` }} /></div>}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{bytesText(t, x.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.tables.every((x) => x.rows === null) && <div className="mt-3"><Quiet>{t("This could not be read just now.")}</Quiet></div>}
      </Panel>
    </div>
  );
}
