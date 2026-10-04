import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { PERMISSIONS } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { deviceLabel } from "@/lib/device-label";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateUserDialog, EditUserDialog } from "./user-dialogs";
import { PermissionMatrix } from "./permission-matrix";
import { ROLE_DEPARTMENT } from "@/lib/permissions";

export const metadata: Metadata = { title: "Staff & roles" };

export default async function UsersPage() {
  const actor = await requirePagePermission("users.manage");
  const [users, roles] = await Promise.all([
    // The PIN's state only (set / locked) — never its hash.
    db.user.findMany({
      select: {
        id: true, fullName: true, email: true, phone: true, roleId: true, isActive: true, mustChangePassword: true, lastLoginAt: true,
        role: { select: { code: true, name: true } },
      },
      orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    }),
    db.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { createdAt: "asc" } }),
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
    .map((r) => ({ id: r.id, name: r.name, department: ROLE_DEPARTMENT[r.code] ?? "Other", screen: screenRoleIds.has(r.id) }));

  return (
    <div className="w-full">
      <PageHeader
        title="Staff & roles"
        description="Accounts, roles and what each role is allowed to do. Permissions are enforced on the server."
        actions={<CreateUserDialog roles={assignableRoles}
          screenLogins={users.filter((u) => u.isActive && screenRoleIds.has(u.roleId)).map((u) => `${u.fullName} · ${u.email}`)} />}
      />
      <Tabs defaultValue="staff">
        <TabsList className="mb-4">
          <TabsTrigger value="staff">Staff ({users.filter((u) => u.isActive).length} active)</TabsTrigger>
          <TabsTrigger value="roles">Role permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="staff">
          <Card>
            <CardContent className="p-0">
              <Table data-stack>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const editable = actor.roleCode === "OWNER" || u.role.code !== "OWNER";
                    return (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.fullName}
                          {u.id === actor.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                          <span className="block text-xs text-muted-foreground md:hidden">{u.email}</span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{u.email}</TableCell>
                        <TableCell>{u.role.name}</TableCell>
                        <TableCell className="hidden lg:table-cell text-muted-foreground">
                          {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            {u.isActive ? (
                              u.mustChangePassword ? <Badge variant="outline">Pending first login</Badge> : <Badge variant="secondary">Active</Badge>
                            ) : (
                              <Badge variant="destructive">Inactive</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {editable && (
                            <EditUserDialog
                              roles={assignableRoles}
                              isSelf={u.id === actor.id}
                              user={{ id: u.id, fullName: u.fullName, phone: u.phone ?? "", roleId: u.roleId, isActive: u.isActive, email: u.email }}
                              screens={screenRoleIds.has(u.roleId) ? screenSessions.filter((x) => x.userId === u.id).map((x) => ({ id: x.id, label: deviceLabel(x.userAgent).label, lastSeen: formatDateTime(x.lastSeenAt) })) : null}
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
              <CardTitle>Role permissions</CardTitle>
              <CardDescription>
                The Owner role always has full access. Changes apply from the staff member&apos;s next page load and are audited.
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
