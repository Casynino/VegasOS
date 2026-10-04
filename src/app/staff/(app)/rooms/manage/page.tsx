import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { formatTZS } from "@/lib/format";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { PageHeader } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RoomDialog, RoomTypeDialog } from "./dialogs";

export const metadata: Metadata = { title: "Room types & inventory" };

export default async function ManageRoomsPage() {
  const user = await requirePagePermission("rooms.manage");
  const [types, rooms, amenities] = await Promise.all([
    db.roomType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { amenities: true, _count: { select: { rooms: { where: { isActive: true } } } } },
    }),
    db.room.findMany({ orderBy: [{ isActive: "desc" }, { number: "asc" }], include: { roomType: true } }),
    db.amenity.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const typeOptions = types.map((t) => ({ id: t.id, name: t.name }));
  const activeRooms = rooms.filter((r) => r.isActive).length;

  return (
    <div className="w-full space-y-6">
      <Link href="/staff/rooms" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> Room board</Link>
      <PageHeader
        title="Room types & inventory"
        description={`${activeRooms} active guest rooms. Rates here are the only source of room prices for the website and reception.`}
        actions={<RoomDialog types={typeOptions} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Room types & rates</CardTitle>
          <CardDescription>Rate changes apply to new bookings; existing bookings keep the rate they were booked at.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-stack>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Rate / night</TableHead>
                <TableHead className="hidden sm:table-cell text-right">USD</TableHead>
                <TableHead className="hidden md:table-cell">Guests</TableHead>
                <TableHead>Rooms</TableHead>
                <TableHead className="hidden md:table-cell">Website</TableHead>
                <TableHead className="w-10"><span className="sr-only">Edit</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}{!t.isActive && <Badge variant="destructive" className="ml-2">inactive</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTZS(t.baseRate)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">{t.displayRateUsd ? `$${t.displayRateUsd}` : "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{t.maxAdults} adults{t.maxChildren ? ` + ${t.maxChildren} child` : ""}</TableCell>
                  <TableCell className="tabular-nums">{t._count.rooms}</TableCell>
                  <TableCell className="hidden md:table-cell">{t.isPublic ? "Shown" : "Hidden"}</TableCell>
                  <TableCell>
                    <RoomTypeDialog
                      canPrice={can(user, "pricing.manage")}
                      amenities={amenities.map((a) => ({ id: a.id, name: a.name }))}
                      type={{
                        id: t.id, name: t.name, baseRate: t.baseRate, displayRateUsd: t.displayRateUsd ?? "",
                        maxAdults: t.maxAdults, maxChildren: t.maxChildren, bedType: t.bedType ?? "", sizeSqm: t.sizeSqm ?? "",
                        shortDescription: t.shortDescription ?? "", description: t.description ?? "",
                        images: (t.images as string[]).join("\n"), isPublic: t.isPublic, isActive: t.isActive,
                        amenityIds: t.amenities.map((a) => a.amenityId),
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rooms</CardTitle>
          <CardDescription>Meeting Room 32 is managed separately and is not part of guest-room inventory.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-stack>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden sm:table-cell">Floor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"><span className="sr-only">Edit</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r) => (
                <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                  <TableCell className="font-medium tabular-nums">{r.number}</TableCell>
                  <TableCell>{r.roomType.name}</TableCell>
                  <TableCell className="hidden sm:table-cell">{r.floor ?? "—"}</TableCell>
                  <TableCell>{r.isActive ? ROOM_STATUS_META[r.status].label : <Badge variant="outline">Removed</Badge>}</TableCell>
                  <TableCell>
                    <RoomDialog types={typeOptions} room={{ id: r.id, number: r.number, roomTypeId: r.roomTypeId, floor: r.floor ?? "", notes: r.notes ?? "", isActive: r.isActive }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
