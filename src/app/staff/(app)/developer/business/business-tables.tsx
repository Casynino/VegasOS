import type { ReactNode } from "react";
import type { T } from "@/i18n/translate";
import { msg } from "@/i18n/msg";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { formatQty, KIND_LABEL, reasonLabel, type MovementKind } from "@/lib/inventory";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { EXPENSE_STATUS_META } from "@/lib/expense-status";
import { Panel } from "@/components/dashboard/kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  CustomerRow, ExpenseRow, LowStockRow, MovementRow, OrderRow, PaymentRow, StayRow,
} from "@/server/services/developer-business";

/**
 * The Business tables — plain, read-only, server-drawn HTML: no button, no form, no input and no link to a page that edits anything.
 * Amounts are in full (TZS 703,000 — never 703k). On a phone each table becomes a stack of small cards (data-stack + a label on every
 * cell, written here on the server so nothing has to be added in the browser).
 */

const LIMIT_NOTE = msg("Latest {n} · read-only");

const NUM = "text-right tabular-nums whitespace-nowrap";
const HEAD = "h-9 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

const chip = "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium";
const quiet = "border-border bg-muted/50 text-muted-foreground";
const warn = "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300";
const bad = "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300";
const good = "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-300";

function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <TableCell data-label={label} className={className}>{children}</TableCell>;
}

function Grid({ heads, children }: { heads: { label: string; num?: boolean }[]; children: ReactNode }) {
  return (
    <Table data-stack>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {heads.map((h) => <TableHead key={h.label} className={cn(HEAD, h.num && "text-right")}>{h.label}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

function Block({ title, rows, t, children, empty }: { title: string; rows: number; t: T; children: ReactNode; empty: string }) {
  return (
    <Panel title={title} subtitle={t(LIMIT_NOTE, { n: 30 })} bodyClassName="-mx-1 sm:-mx-2">
      {rows === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p> : children}
    </Panel>
  );
}

const when = (t: T, d: Date, tz: string) => t.dateTime(d, tz);
const dash = <span className="text-muted-foreground">—</span>;

// ───────────────────────────────────────────── stays ─────────────────────────────────────────────
export function StaysTable({ rows, t }: { rows: StayRow[]; t: T }) {
  return (
    <Block title={t("Stays")} rows={rows.length} t={t} empty={t("There are no bookings yet.")}>
      <Grid heads={[{ label: t("Code") }, { label: t("Guest") }, { label: t("Rooms") }, { label: t("Stay") }, { label: t("Status") }, { label: t("Total"), num: true }, { label: t("Paid"), num: true }, { label: t("Balance"), num: true }]}>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <Cell label={t("Code")} className="font-mono text-xs">{r.reference}</Cell>
            <Cell label={t("Guest")} className="font-medium">{r.guest}</Cell>
            <Cell label={t("Rooms")}>{r.rooms.length ? r.rooms.join(", ") : dash}</Cell>
            <Cell label={t("Stay")} className="whitespace-nowrap text-muted-foreground">{t.dateRange(r.arrival, r.departure)}</Cell>
            <Cell label={t("Status")}><span className={cn(chip, RESERVATION_STATUS_META[r.status].className)}>{t(RESERVATION_STATUS_META[r.status].label)}</span></Cell>
            <Cell label={t("Total")} className={NUM}>{formatTZS(r.total)}</Cell>
            <Cell label={t("Paid")} className={NUM}>{formatTZS(r.paid)}</Cell>
            <Cell label={t("Balance")} className={cn(NUM, r.balance > 0 && "font-semibold text-rose-700 dark:text-rose-300")}>{formatTZS(r.balance)}</Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}

// ───────────────────────────────────────────── money ─────────────────────────────────────────────
export function PaymentsTable({ rows, t, timezone }: { rows: PaymentRow[]; t: T; timezone: string }) {
  return (
    <Block title={t("Payments")} rows={rows.length} t={t} empty={t("No payments have been recorded yet.")}>
      <Grid heads={[{ label: t("When") }, { label: t("For") }, { label: t("Kind") }, { label: t("Amount"), num: true }, { label: t("Paid into") }, { label: t("Recorded by") }, { label: t("State") }]}>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <Cell label={t("When")} className="whitespace-nowrap">{when(t, p.at, timezone)}</Cell>
            <Cell label={t("For")}>
              <span className="font-mono text-xs">{p.forWhat ?? "—"}</span>
              {p.reference && <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.reference}</span>}
            </Cell>
            <Cell label={t("Kind")}><span className={cn(chip, p.kind === "REFUND" ? warn : quiet)}>{p.kind === "REFUND" ? t("Refund") : t("Payment")}</span></Cell>
            <Cell label={t("Amount")} className={cn(NUM, p.reversed && "text-muted-foreground line-through")}>{formatTZS(p.amount)}</Cell>
            <Cell label={t("Paid into")}>{t(p.method)}<span className="block text-xs text-muted-foreground">{p.account}</span></Cell>
            <Cell label={t("Recorded by")}>{p.recordedBy}</Cell>
            <Cell label={t("State")}>
              {p.reversed ? <span className={cn(chip, bad)} title={p.reversalReason ?? undefined}>{t("Reversed")}</span> : <span className={cn(chip, good)}>{t("Posted")}</span>}
            </Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}

export function ExpensesTable({ rows, t, timezone }: { rows: ExpenseRow[]; t: T; timezone: string }) {
  return (
    <Block title={t("Expenses")} rows={rows.length} t={t} empty={t("No expenses have been recorded yet.")}>
      <Grid heads={[{ label: t("When") }, { label: t("Expense") }, { label: t("Payee") }, { label: t("Amount"), num: true }, { label: t("Paid from") }, { label: t("Recorded by") }, { label: t("State") }]}>
        {rows.map((e) => (
          <TableRow key={e.id}>
            <Cell label={t("When")} className="whitespace-nowrap">{when(t, e.at, timezone)}</Cell>
            <Cell label={t("Expense")}>
              <span className="block max-w-[28ch] truncate sm:max-w-none">{e.description}</span>
              <span className="block text-xs text-muted-foreground">{t(e.category)}{e.number ? ` · ${e.number}` : ""}</span>
            </Cell>
            <Cell label={t("Payee")}>{e.payee ?? dash}</Cell>
            <Cell label={t("Amount")} className={cn(NUM, e.voided && "text-muted-foreground line-through")}>{formatTZS(e.amount)}</Cell>
            <Cell label={t("Paid from")}>{e.account ?? (e.method ? t(e.method) : dash)}</Cell>
            <Cell label={t("Recorded by")}>{e.recordedBy}</Cell>
            <Cell label={t("State")}><span className={cn(chip, EXPENSE_STATUS_META[e.status].className)}>{t(EXPENSE_STATUS_META[e.status].label)}</span></Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}

// ───────────────────────────────────────────── restaurant ─────────────────────────────────────────────
const ORDER_STATE: Record<OrderRow["status"], string> = {
  PENDING: msg("Waiting"), ACCEPTED: msg("Accepted"), PREPARING: msg("Preparing"), READY: msg("Ready"), OUT_FOR_DELIVERY: msg("Out for delivery"),
  DELIVERED: msg("Delivered"), COMPLETED: msg("Completed"), CANCELLED: msg("Cancelled"), COLLECTED: msg("Collected"),
};
const ORDER_TYPE: Record<OrderRow["type"], string> = { DINE_IN: msg("Dine in"), TAKEAWAY: msg("Take out"), ROOM_SERVICE: msg("Room service"), PICKUP: msg("Pickup") };
const ORDER_PAYMENT: Record<OrderRow["paymentStatus"], string> = {
  UNPAID: msg("Not paid"), PENDING_CONFIRMATION: msg("Waiting for confirmation"), PARTIALLY_PAID: msg("Part paid"), PAID: msg("Paid"), REFUNDED: msg("Refunded"),
};
const stateStyle = (s: OrderRow["status"]) => (s === "CANCELLED" ? bad : s === "COMPLETED" || s === "DELIVERED" || s === "COLLECTED" ? good : quiet);

export function OrdersTable({ rows, t, timezone }: { rows: OrderRow[]; t: T; timezone: string }) {
  return (
    <Block title={t("Restaurant orders")} rows={rows.length} t={t} empty={t("There are no restaurant orders yet.")}>
      <Grid heads={[{ label: t("Order") }, { label: t("When") }, { label: t("Place") }, { label: t("State") }, { label: t("Total"), num: true }, { label: t("Paid"), num: true }]}>
        {rows.map((o) => (
          <TableRow key={o.id}>
            <Cell label={t("Order")} className="font-mono text-xs">{o.number}</Cell>
            <Cell label={t("When")} className="whitespace-nowrap text-muted-foreground">{when(t, o.at, timezone)}</Cell>
            <Cell label={t("Place")}>
              {o.table ?? (o.room ? t("Room {room}", { room: o.room }) : t(ORDER_TYPE[o.type]))}
              <span className="block text-xs text-muted-foreground">{t(ORDER_TYPE[o.type])}</span>
            </Cell>
            <Cell label={t("State")}><span className={cn(chip, stateStyle(o.status))}>{t(ORDER_STATE[o.status])}</span></Cell>
            <Cell label={t("Total")} className={NUM}>{formatTZS(o.total)}</Cell>
            <Cell label={t("Paid")} className={NUM}>
              {formatTZS(o.paid)}
              {/* An order put on a room's bill is paid with the stay: "TZS 0 paid" there is not "unpaid". */}
              <span className="block text-xs font-normal text-muted-foreground">{o.settlement === "ROOM" ? t("On the room bill") : t(ORDER_PAYMENT[o.paymentStatus])}</span>
            </Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}

// ───────────────────────────────────────────── stores ─────────────────────────────────────────────
const MOVEMENT_STATUS: Record<string, string> = { POSTED: msg("Posted"), PENDING: msg("Waiting for approval"), REJECTED: msg("Rejected") };

export function MovementsTable({ rows, t, timezone }: { rows: MovementRow[]; t: T; timezone: string }) {
  return (
    <Block title={t("Stock movements")} rows={rows.length} t={t} empty={t("No stock has moved yet.")}>
      <Grid heads={[{ label: t("When") }, { label: t("Item") }, { label: t("Department") }, { label: t("What happened") }, { label: t("Change"), num: true }, { label: t("State") }, { label: t("Recorded by") }]}>
        {rows.map((m) => (
          <TableRow key={m.id}>
            <Cell label={t("When")} className="whitespace-nowrap">{when(t, m.at, timezone)}</Cell>
            <Cell label={t("Item")} className="font-medium">{m.item}</Cell>
            <Cell label={t("Department")}>{t(m.department)}</Cell>
            <Cell label={t("What happened")}>
              {t(KIND_LABEL[m.kind as MovementKind] ?? m.kind)}
              <span className="block text-xs text-muted-foreground">{t(reasonLabel(m.reason))}</span>
            </Cell>
            <Cell label={t("Change")} className={NUM}>{m.change > 0 ? "+" : m.change < 0 ? "−" : ""}{formatQty(Math.abs(m.change), m.unit, t)}</Cell>
            <Cell label={t("State")}><span className={cn(chip, m.status === "REJECTED" ? bad : m.status === "PENDING" ? warn : quiet)}>{t(MOVEMENT_STATUS[m.status] ?? m.status)}</span></Cell>
            <Cell label={t("Recorded by")}>{m.recordedBy ?? dash}</Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}

export function LowStockTable({ rows, t }: { rows: LowStockRow[]; t: T }) {
  return (
    <Block title={t("Items below their minimum")} rows={rows.length} t={t} empty={t("No item is below its minimum.")}>
      <Grid heads={[{ label: t("Item") }, { label: t("Department") }, { label: t("On hand"), num: true }, { label: t("Minimum"), num: true }]}>
        {rows.map((i) => (
          <TableRow key={i.id}>
            <Cell label={t("Item")} className="font-medium">{i.item}</Cell>
            <Cell label={t("Department")}>{t(i.department)}</Cell>
            <Cell label={t("On hand")} className={cn(NUM, "font-semibold text-rose-700 dark:text-rose-300")}>{formatQty(i.quantity, i.unit, t)}</Cell>
            <Cell label={t("Minimum")} className={NUM}>{formatQty(i.minimum, i.unit, t)}</Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}

// ───────────────────────────────────────────── customers ─────────────────────────────────────────────
export function CustomersTable({ rows, t }: { rows: CustomerRow[]; t: T }) {
  return (
    <Block title={t("Customers")} rows={rows.length} t={t} empty={t("There are no customers yet.")}>
      <Grid heads={[{ label: t("Name") }, { label: t("Code") }, { label: t("Phone") }, { label: t("Last stay") }]}>
        {rows.map((c) => (
          <TableRow key={c.id}>
            <Cell label={t("Name")} className="font-medium">{c.name}{c.vip && <span className={cn(chip, warn, "ml-2 align-middle")}>{t("VIP")}</span>}</Cell>
            <Cell label={t("Code")} className="font-mono text-xs">{c.reference ?? dash}</Cell>
            <Cell label={t("Phone")} className="whitespace-nowrap">{c.phone ?? dash}</Cell>
            <Cell label={t("Last stay")} className="whitespace-nowrap text-muted-foreground">{c.lastStay ? t.dateRange(c.lastStay.arrival, c.lastStay.departure) : dash}</Cell>
          </TableRow>
        ))}
      </Grid>
    </Block>
  );
}
