import type { GroupView } from "@/server/services/groups";

/** Everyone staying with the group: each room's guest and who shares it. */
export function groupMembers(g: GroupView) {
  const seen = new Map<string, { id: string; fullName: string; phone: string | null; room: string | null; reservationId: string | null; status: string | null; sharing: boolean }>();
  for (const r of g.rooms) {
    if (r.status === "CANCELLED" || r.status === "NO_SHOW") continue;
    for (const [p, sharing] of [[r.guest, false], ...r.occupants.map((o) => [o, true] as const)] as const) {
      if (!seen.has(p.id)) seen.set(p.id, { id: p.id, fullName: p.fullName, phone: p.phone, room: r.room?.number ?? null, reservationId: r.id, status: r.status, sharing });
    }
  }
  return [...seen.values()];
}
