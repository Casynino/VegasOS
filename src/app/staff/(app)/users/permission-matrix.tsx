"use client";

import { Fragment, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { setRolePermissionAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Role = { id: string; code: string; name: string; locked: boolean; granted: string[] };

/** Each permission group's heading — its code prefix in words (shown in capitals); an unknown prefix shows as before. */
const GROUP_LABEL: Record<string, string> = {
  assets: msg("Assets"), audit: msg("Audit"), bar: msg("Bar"), booking_requests: msg("Booking requests"), contact: msg("Contact"), corporate: msg("Corporate"),
  dashboard: msg("Dashboard"), developer: msg("Developer"), expenses: msg("Expenses"), finance: msg("Finance"), guests: msg("Guests"), hotel_qr: msg("Hotel QR"), spin: msg("Spin to Win"),
  inventory: msg("Inventory"), invoices: msg("Invoices"), kitchen: msg("Kitchen"), ledger: msg("Ledger"), meeting: msg("Meeting"),
  payments: msg("Payments"), pricing: msg("Pricing"), reports: msg("Reports"), requests: msg("Requests"), reservations: msg("Reservations"),
  restaurant: msg("Restaurant"), revenue: msg("Revenue"), rooms: msg("Rooms"), settings: msg("Settings"), shifts: msg("Shifts"),
  staff: msg("Staff"), transport: msg("Transport"), users: msg("Users"), website: msg("Website"),
};

/**
 * `lockedPermissions`: rights nobody can switch here (the Developer-only right). `isDeveloper`: a Developer must give a reason before
 * changing any right — it is sent with every change and written into the audit entry (the server asks for it; this only helps them).
 * `developerLocked`: rights a Developer cannot switch (money, staff management); `developerKeepOn`: rights a Developer cannot take away (the audit
 * trail). The server refuses them too — here they are only shown as fixed instead of as switches that always fail.
 */
export function PermissionMatrix({ permissions, roles, lockedPermissions = [], isDeveloper = false, developerLocked = [], developerKeepOn = [] }: {
  permissions: { code: string; description: string }[]; roles: Role[]; lockedPermissions?: string[]; isDeveloper?: boolean; developerLocked?: string[]; developerKeepOn?: string[];
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const needsReason = isDeveloper && reason.trim().length < 5;
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
      const res = await setRolePermissionAction({ roleId: role.id, permission: code, granted, reason: isDeveloper ? reason : undefined });
      if (!res.ok) toast.error(res.error);
    });
  }

  const groups = Object.groupBy(permissions, (p) => p.code.split(".")[0]);

  return (
    <div className="overflow-x-auto">
      {isDeveloper && (
        <div className="mb-4 max-w-xl space-y-1.5">
          <Label htmlFor="matrix-reason">{t("Reason for the change")}</Label>
          <Input id="matrix-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoComplete="off" placeholder={t("Why are you changing a right? (at least 5 characters)")} />
          <p className="text-xs text-muted-foreground">{t("As a Developer you give a reason for every change. It is written in the audit trail with the change.")}</p>
          <p className="text-xs text-muted-foreground">{t("The Developer account cannot change rights about money or staff accounts, or take away the audit-trail right. Those switches are fixed: ask the Boss or the MD.")}</p>
        </div>
      )}
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
                          disabled={r.locked || lockedPermissions.includes(p.code) || needsReason || (isDeveloper && (developerLocked.includes(p.code) || (checked && developerKeepOn.includes(p.code))))}
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
