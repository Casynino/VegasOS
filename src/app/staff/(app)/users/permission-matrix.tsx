"use client";

import { Fragment, useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setRolePermissionAction } from "./actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Role = { id: string; code: string; name: string; locked: boolean; granted: string[] };

/** Each permission group's heading — its code prefix in words (shown in capitals); an unknown prefix shows as before. */
const GROUP_LABEL: Record<string, string> = {
  assets: msg("Assets"), bar: msg("Bar"), booking_requests: msg("Booking requests"), contact: msg("Contact"), corporate: msg("Corporate"),
  dashboard: msg("Dashboard"), expenses: msg("Expenses"), finance: msg("Finance"), guests: msg("Guests"), hotel_qr: msg("Hotel QR"),
  inventory: msg("Inventory"), invoices: msg("Invoices"), kitchen: msg("Kitchen"), ledger: msg("Ledger"), meeting: msg("Meeting"),
  payments: msg("Payments"), pricing: msg("Pricing"), reports: msg("Reports"), requests: msg("Requests"), reservations: msg("Reservations"),
  restaurant: msg("Restaurant"), revenue: msg("Revenue"), rooms: msg("Rooms"), settings: msg("Settings"), shifts: msg("Shifts"),
  staff: msg("Staff"), transport: msg("Transport"), users: msg("Users"), website: msg("Website"),
};

export function PermissionMatrix({ permissions, roles }: { permissions: { code: string; description: string }[]; roles: Role[] }) {
  const t = useT();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    roles,
    (state, change: { roleId: string; code: string; granted: boolean }) =>
      state.map((r) =>
        r.id !== change.roleId ? r : {
          ...r,
          granted: change.granted ? [...r.granted, change.code] : r.granted.filter((c) => c !== change.code),
        },
      ),
  );

  function toggle(role: Role, code: string, granted: boolean) {
    startTransition(async () => {
      setOptimistic({ roleId: role.id, code, granted });
      const res = await setRolePermissionAction({ roleId: role.id, permission: code, granted });
      if (!res.ok) toast.error(res.error);
    });
  }

  const groups = Object.groupBy(permissions, (p) => p.code.split(".")[0]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">{t("Permission")}</th>
            {optimistic.map((r) => <th key={r.id} className="w-28 py-2 text-center font-medium">{t(r.name)}</th>)}
          </tr>
        </thead>
        <tbody>
          {Object.entries(groups).map(([group, perms]) => (
            <Fragment key={group}>
              <tr className="bg-muted/50">
                <td colSpan={optimistic.length + 1} className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABEL[group] ? t(GROUP_LABEL[group]) : group.replace("_", " ")}
                </td>
              </tr>
              {perms!.map((p) => (
                <tr key={p.code} className="border-b last:border-0">
                  <td className="py-1.5 pr-4">
                    {t(p.description)}
                    <span className="block font-mono text-[11px] text-muted-foreground">{p.code}</span>
                  </td>
                  {optimistic.map((r) => {
                    const checked = r.granted.includes(p.code);
                    return (
                      <td key={r.id} className="text-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          checked={checked}
                          disabled={r.locked}
                          onChange={(e) => toggle(r, p.code, e.target.checked)}
                          aria-label={`${t(r.name)}: ${t(p.description)}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
