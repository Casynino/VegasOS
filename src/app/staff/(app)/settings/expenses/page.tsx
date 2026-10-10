import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { PageHeader } from "@/components/staff/page-header";
import { FREQUENCY_LABEL, type ExpenseFrequency } from "@/lib/expense-catalog";
import { cn } from "@/lib/utils";
import { ExpenseTypeButton } from "./expense-type-form";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Expense types") };
}

/** The list staff pick from when recording an expense: groups and types (managers keep it tidy). */
export default async function ExpenseTypesPage() {
  await requirePagePermission("settings.manage");
  const t = await getT();
  const groups = await db.expenseCategory.findMany({
    where: { isActive: true }, orderBy: { sortOrder: "asc" },
    include: { items: { orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }] } },
  });
  const options = groups.map((g) => ({ id: g.id, name: g.name }));
  return (
    <div className="w-full space-y-5">
      <PageHeader title={t("Expense types")} description={t("What staff pick when they record money paid out. Staff can also add a new type while recording — it appears here. Hidden types stay on old records.")}
        actions={<ExpenseTypeButton groups={options} />} />
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {groups.map((g) => (
          <section key={g.id} className="rounded-3xl border border-border/70 bg-card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-semibold">{t(g.name)}</p>
              <ExpenseTypeButton groups={options} initial={{ name: "", categoryId: g.id, frequency: "OCCASIONAL", defaultPayee: "", defaultAmount: "", isActive: true }} label={t("Add")} />
            </div>
            <ul className="divide-y divide-border/60 text-sm">
              {g.items.map((i) => (
                <li key={i.id} className={cn("flex items-center justify-between gap-2 py-1.5", !i.isActive && "opacity-50")}>
                  <span className="min-w-0">
                    <span className={cn(!i.isActive && "line-through")}>{t(i.name)}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t(FREQUENCY_LABEL[i.frequency as ExpenseFrequency] ?? i.frequency)}{i.defaultPayee ? ` · ${i.defaultPayee}` : ""}{i.defaultAmount ? ` · ${t("usually {amount}", { amount: i.defaultAmount.toLocaleString("en-US") })}` : ""}{i.useCount ? ` · ${t("used {n}×", { n: i.useCount })}` : ""}{!i.isActive ? ` · ${t("hidden")}` : ""}
                    </span>
                  </span>
                  <ExpenseTypeButton groups={options} initial={{ id: i.id, name: i.name, categoryId: i.categoryId, frequency: i.frequency as ExpenseFrequency, defaultPayee: i.defaultPayee ?? "", defaultAmount: i.defaultAmount ?? "", isActive: i.isActive }} label={t("Edit")} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
