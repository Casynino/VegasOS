import { previewHandover } from "@/server/services/cash-handover";
import { HandoverCard, type CardData, type CardHandover } from "./handover-card";

const iso = (d: Date) => d.toISOString();
const plain = (h: Awaited<ReturnType<typeof previewHandover>>["open"][number]): CardHandover => ({
  id: h.id, number: h.number, status: h.status, declared: h.declared, expected: h.expected, received: h.received, difference: h.difference, reviewNote: h.reviewNote, submittedAt: iso(h.submittedAt),
});

/** The "Cash to hand over" card for reception and the Restaurant Counter — shown on their Collections page. */
export async function HandoverSection({ userId }: { userId: string }) {
  const p = await previewHandover(userId);
  const data: CardData = {
    start: iso(p.start), collected: p.collected, refunds: p.refunds, expected: p.expected, count: p.count,
    rows: p.rows.map((r) => ({ id: r.id, at: iso(r.at), amount: r.amount, refund: r.refund, counted: r.counted, party: r.party, reference: r.reference })),
    open: p.open.map(plain), recent: p.recent.map(plain),
  };
  return <HandoverCard data={data} />;
}
