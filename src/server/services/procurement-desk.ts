import "server-only";
import { db } from "../db";
import { AppError } from "../errors";

/**
 * What the procurement desk reads: the purchases that Finance approved, where each one stands (quote → authorize →
 * order → delivery → invoice → payment), and one purchase in full. Reading only — every change is in procurement.ts.
 */

/** Today on the hotel's calendar (EAT) — the day a payment or an invoice is dated by default. */
export const calendarToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export const TABS = ["quote", "authorize", "order", "delivery", "invoices", "closed"] as const;
export type DeskTab = (typeof TABS)[number];

const OPEN_INVOICE = ["RECEIVED", "VERIFIED", "DISPUTED", "PART_PAID"];

/** Which tab a purchase belongs to. One tab only, so the numbers never double up. */
export function tabOf(r: { status: string; chosenQuoteId: string | null; authorizedAt: Date | null; invoices: { status: string }[] }): DeskTab | null {
  switch (r.status) {
    case "APPROVED": return r.chosenQuoteId && r.authorizedAt ? "order" : "quote";
    case "AWAITING_AUTHORIZATION": return "authorize";
    case "ORDERED": case "PART_DELIVERED": return "delivery";
    case "DELIVERED": return "invoices";
    case "COMPLETED": case "CANCELLED": return "closed";
    default: return null;
  }
}

export interface DeskFilters {
  tab?: DeskTab;
  q?: string;
  department?: string;
  requester?: string;
  supplier?: string;
  status?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  from?: string | null;
  to?: string | null;
}

const LIST_INCLUDE = {
  requestedBy: { select: { id: true, fullName: true } },
  inventoryDepartment: { select: { name: true } },
  chosenQuote: { select: { id: true, total: true, supplier: { select: { name: true } }, supplierName: true } },
  supplier: { select: { id: true, name: true } },
  quotes: { select: { id: true, total: true, supplierId: true } },
  invoices: { select: { id: true, status: true, amount: true, paidAmount: true, dueOn: true, supplierId: true } },
} as const;

/** The money a purchase is about, at its furthest stage — for filtering by amount. */
const amountOf = (r: { orderTotal: number | null; chosenQuote: { total: number } | null; approvedBudget: number | null; estimatedTotal: number | null }) =>
  r.orderTotal ?? r.chosenQuote?.total ?? r.approvedBudget ?? r.estimatedTotal ?? 0;

export async function procurementBoard(f: DeskFilters, deptNames: Map<string, string>) {
  const rows = await db.stockRequest.findMany({
    where: {
      AND: [
        {
          OR: [
            { status: { in: ["APPROVED", "AWAITING_AUTHORIZATION", "ORDERED", "PART_DELIVERED", "DELIVERED"] } },
            // Closed ones: only those that went through an order (a request cancelled before approval is not a purchase).
            { status: { in: ["COMPLETED", "CANCELLED"] }, orderNumber: { not: null } },
          ],
        },
        ...(f.department ? [{ OR: [{ departmentId: f.department }, { department: f.department }] }] : []),
      ],
      ...(f.requester ? { requestedById: f.requester } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+03:00`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00+03:00`).getTime() + 86_400_000) } : {}) } } : {}),
    },
    include: LIST_INCLUDE, orderBy: [{ urgent: "desc" }, { updatedAt: "desc" }], take: 400,
  });
  const q = f.q?.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (q && ![r.number, r.orderNumber, r.title, r.supplier?.name, r.chosenQuote?.supplier?.name].some((x) => x?.toLowerCase().includes(q))) return false;
    if (f.supplier && ![r.supplierId, ...r.quotes.map((x) => x.supplierId), ...r.invoices.map((x) => x.supplierId)].includes(f.supplier)) return false;
    const amount = amountOf(r);
    if (f.minAmount != null && amount < f.minAmount) return false;
    if (f.maxAmount != null && amount > f.maxAmount) return false;
    return true;
  });
  const counts: Record<DeskTab, number> = { quote: 0, authorize: 0, order: 0, delivery: 0, invoices: 0, closed: 0 };
  for (const r of filtered) { const t = tabOf(r); if (t) counts[t]++; }
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const list = filtered.filter((r) => tabOf(r) === (f.tab ?? "quote")).slice(0, 150).map((r) => {
    const open = r.invoices.filter((i) => OPEN_INVOICE.includes(i.status));
    return {
      id: r.id, number: r.number, orderNumber: r.orderNumber, title: r.title, status: r.status, ready: tabOf(r) === "order", priority: r.priority, urgent: r.urgent,
      department: r.inventoryDepartment?.name ?? deptNames.get(r.department) ?? r.department, requester: r.requestedBy.fullName,
      estimatedTotal: r.estimatedTotal, approvedBudget: r.approvedBudget, quotes: r.quotes.length,
      supplier: r.supplier?.name ?? r.chosenQuote?.supplier?.name ?? r.chosenQuote?.supplierName ?? null,
      quoted: r.chosenQuote?.total ?? null, orderTotal: r.orderTotal,
      expectedDeliveryOn: r.expectedDeliveryOn?.toISOString().slice(0, 10) ?? null,
      late: !!r.expectedDeliveryOn && ["ORDERED", "PART_DELIVERED"].includes(r.status) && r.expectedDeliveryOn.toISOString().slice(0, 10) < today,
      invoiced: r.invoices.filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + i.amount, 0),
      owed: open.reduce((s, i) => s + (i.amount - i.paidAmount), 0),
      toVerify: r.invoices.filter((i) => i.status === "RECEIVED").length,
      toPay: r.invoices.filter((i) => i.status === "VERIFIED" || i.status === "PART_PAID").length,
      disputed: r.invoices.filter((i) => i.status === "DISPUTED").length,
      at: r.updatedAt.toISOString(),
    };
  });
  return { counts, list, truncated: rows.length >= 400 };
}
export type BoardRow = Awaited<ReturnType<typeof procurementBoard>>["list"][number];

/** The people and suppliers a filter can pick from. */
export async function boardFilterOptions() {
  const [suppliers, requesters, departments] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { stockRequests: { some: {} } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.inventoryDepartment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { suppliers, requesters, departments };
}

/** One purchase in full: what was asked and approved, what is in stock now, every quotation, the order, each delivery, each invoice and payment, the documents and the history. */
export async function procurementWorkspace(id: string) {
  const r = await db.stockRequest.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, fullName: true } },
      decidedBy: { select: { fullName: true } },
      authorizedBy: { select: { fullName: true } },
      orderedBy: { select: { fullName: true } },
      inventoryDepartment: { select: { name: true } },
      supplier: { select: { id: true, name: true, phone: true } },
      items: { where: { removedAt: null }, orderBy: { id: "asc" }, include: { inventoryItem: { select: { id: true, name: true, unit: true, quantity: true, reorderLevel: true } } } },
      quotes: {
        orderBy: { createdAt: "asc" },
        include: { supplier: { select: { id: true, name: true } }, recordedBy: { select: { fullName: true } }, lines: true },
      },
      deliveries: { orderBy: { receivedAt: "asc" }, include: { receivedBy: { select: { fullName: true } }, lines: true } },
      invoices: {
        orderBy: { recordedAt: "asc" },
        include: {
          recordedBy: { select: { fullName: true } }, verifiedBy: { select: { fullName: true } }, supplier: { select: { name: true } },
          payments: { orderBy: { createdAt: "asc" }, include: { account: { select: { name: true } }, paidBy: { select: { fullName: true } }, expense: { select: { number: true } } } },
        },
      },
      documents: { orderBy: { createdAt: "asc" }, include: { file: { select: { contentType: true, fileName: true } }, uploadedBy: { select: { fullName: true } } } },
      events: { orderBy: { at: "asc" } },
    },
  });
  if (!r) throw new AppError("Purchase not found.", "NOT_FOUND");
  return r;
}
export type Workspace = Awaited<ReturnType<typeof procurementWorkspace>>;

/** Where Finance sends the money from: the company accounts that may pay expenses. */
export async function payingAccounts() {
  return db.moneyAccount.findMany({ where: { isActive: true, acceptsExpenses: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** What waits for Finance on purchases — shown on the Finance desk and in the bell. */
export async function financeQueue() {
  const [authorize, verify, pay] = await Promise.all([
    db.stockRequest.aggregate({ where: { status: "AWAITING_AUTHORIZATION" }, _count: true, _sum: { orderTotal: true } }),
    db.supplierInvoice.aggregate({ where: { status: "RECEIVED" }, _count: true, _sum: { amount: true } }),
    db.supplierInvoice.aggregate({ where: { status: { in: ["VERIFIED", "PART_PAID"] } }, _count: true, _sum: { amount: true, paidAmount: true } }),
  ]);
  return {
    authorize: authorize._count,
    verify: verify._count, verifyAmount: verify._sum.amount ?? 0,
    pay: pay._count, payAmount: (pay._sum.amount ?? 0) - (pay._sum.paidAmount ?? 0),
  };
}

/**
 * The purchase prices that wait for the BOSS or the MD: Finance authorizes up to its own limit (Settings) and cannot go above it. Nothing
 * when no limit is set — then Finance decides every one. This is what Finance's work leaves on the Boss's own dashboard.
 */
export async function purchasesAboveFinanceLimit() {
  const limit = (await db.hotelSettings.findFirst({ select: { financeAuthorizationLimit: true } }))?.financeAuthorizationLimit ?? null;
  if (limit == null) return { count: 0, limit: null as number | null };
  const rows = await db.stockRequest.findMany({ where: { status: "AWAITING_AUTHORIZATION", chosenQuote: { total: { gt: limit } } }, select: { id: true } });
  return { count: rows.length, limit };
}
