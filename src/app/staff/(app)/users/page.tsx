import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { PERMISSIONS } from "@/lib/permissions";
import { deviceLabel } from "@/lib/device-label";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateUserDialog, EditUserDialog } from "./user-dialogs";
import { PermissionMatrix } from "./permission-matrix";
import { ROLE_DEPARTMENT } from "@/lib/permissions";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Staff & roles") };
}

export default async function UsersPage() {
  const actor = await requirePagePermission("users.manage");
  const t = await getT();
  const [users, roles] = await Promise.all([
    // The PIN's state only (set / locked) — never its hash.
    // "Online · nTZS" (records what customers pay online themselves) is not a person — never listed or edited here.
    db.user.findMany({
      where: { role: { code: { not: "SYSTEM_ONLINE" } } },
      select: {
        id: true, fullName: true, email: true, phone: true, roleId: true, isActive: true, mustChangePassword: true, lastLoginAt: true,
        role: { select: { code: true, name: true } },
      },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    }),
    db.role.findMany({ where: { code: { not: "SYSTEM_ONLINE" } }, include: { permissions: { include: { permission: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  // The shared restaurant screen's role: its account is the restaurant's own login, not a person.
  const isScreen = (r: (typeof roles)[number]) => {
    const codes = r.permissions.map((p) => p.permission.code);
    return codes.includes("restaurant.device") && !["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((c) => codes.includes(c));
  };
  const screenRoleIds = new Set(roles.filter(isScreen).map((r) => r.id));
  // Where the restaurant screen's login is signed in (the MD can sign one screen out).
  const screenSessions = await db.session.findMany({
    where: { expiresAt: { gt: new Date() }, userId: { in: users.filter((u) => screenRoleIds.has(u.roleId)).map((u) => u.id) } },
    orderBy: { lastSeenAt: "desc" }, select: { id: true, userId: true, userAgent: true, lastSeenAt: true },
  });
  const assignableRoles = roles
    .filter((r) => actor.roleCode === "OWNER" || r.code !== "OWNER")
    .map((r) => ({ id: r.id, name: r.name, department: ROLE_DEPARTMENT[r.code] ?? msg("Other"), screen: screenRoleIds.has(r.id) }));

  return (
    <div className="w-full">
      <PageHeader
        title={t("Staff & roles")}
        description={t("Accounts, roles and what each role is allowed to do. Permissions are enforced on the server.")}
        actions={<CreateUserDialog roles={assignableRoles}
          screenLogins={users.filter((u) => u.isActive && screenRoleIds.has(u.roleId)).map((u) => `${u.fullName} · ${u.email}`)} />}
      />
      <Tabs defaultValue="staff">
        <TabsList className="mb-4">
          <TabsTrigger value="staff">{t("Staff ({n} active)", { n: users.filter((u) => u.isActive).length })}</TabsTrigger>
          <TabsTrigger value="roles">{t("Role permissions")}</TabsTrigger>
        </TabsList>
        <TabsContent value="staff">
          <Card>
            <CardContent className="p-0">
              <Table data-stack>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Name")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Email")}</TableHead>
                    <TableHead>{t("Role")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Last sign-in")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="w-10"><span className="sr-only">{t("Actions")}</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const editable = actor.roleCode === "OWNER" || u.role.code !== "OWNER";
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.fullName}
                          {u.id === actor.id && <span className="ml-1 text-xs text-muted-foreground">{t("(you)")}</span>}
                          <span className="block text-xs text-muted-foreground md:hidden">{u.email}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                        <TableCell>{t(u.role.name)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {u.lastLoginAt ? t.dateTime(u.lastLoginAt) : t("Never")}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            {u.isActive ? (
                              u.mustChangePassword ? <Badge variant="outline">{t("Pending first login")}</Badge> : <Badge variant="secondary">{t("Active")}</Badge>
                            ) : (
                              <Badge variant="destructive">{t("Inactive")}</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {editable && (
                            <EditUserDialog
                              roles={assignableRoles}
                              isSelf={u.id === actor.id}
                              user={{ id: u.id, fullName: u.fullName, phone: u.phone ?? "", roleId: u.roleId, isActive: u.isActive, email: u.email }}
                              screens={screenRoleIds.has(u.roleId) ? screenSessions.filter((x) => x.userId === u.id).map((x) => ({ id: x.id, label: deviceLabel(x.userAgent, t).label, lastSeen: t.dateTime(x.lastSeenAt) })) : null}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle>{t("Role permissions")}</CardTitle>
              <CardDescription>
                {t("The Owner role always has full access. Changes apply from the staff member's next page load and are audited.")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PermissionMatrix
                permissions={Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description }))}
                roles={roles.map((r) => ({
                  id: r.id,
                  code: r.code,
                  name: r.name,
                  locked: r.code === "OWNER" || (r.code === "MANAGER" && actor.roleCode !== "OWNER"),
                  granted: r.permissions.map((p) => p.permission.code),
                }))}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
