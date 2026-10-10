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
import { AmenityChinese, RoomDialog, RoomTypeDialog } from "./dialogs";
import { getT } from "@/i18n/server";
import { translationForms } from "@/server/services/translations";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Room types & inventory") };
}

export default async function ManageRoomsPage() {
  const user = await requirePagePermission("rooms.manage");
  const t = await getT();
  const [types, rooms, amenities] = await Promise.all([
    db.roomType.findMany({
      orderBy: { sortOrder: "asc" },
      include: { amenities: true, _count: { select: { rooms: { where: { isActive: true } } } } },
    }),
    db.room.findMany({ orderBy: [{ isActive: "desc" }, { number: "asc" }], include: { roomType: true } }),
    db.amenity.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const typeOptions = types.map((rt) => ({ id: rt.id, name: t(rt.name) }));
  const activeRooms = rooms.filter((r) => r.isActive).length;
  const [typeZh, amenityZh] = await Promise.all([translationForms("roomType", types), translationForms("amenity", amenities)]);

  return (
    <div className="w-full space-y-6">
      <Link href="/staff/rooms" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {t("Room board")}</Link>
      <PageHeader
        title={t("Room types & inventory")}
        description={t("{n} active guest rooms. Rates here are the only source of room prices for the website and reception.", { n: activeRooms })}
        actions={<RoomDialog types={typeOptions} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("Room types & rates")}</CardTitle>
          <CardDescription>{t("Rate changes apply to new bookings; existing bookings keep the rate they were booked at.")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-stack>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Type")}</TableHead>
                <TableHead className="text-right">{t("Rate / night")}</TableHead>
                <TableHead className="hidden sm:table-cell text-right">USD</TableHead>
                <TableHead className="hidden md:table-cell">{t("Guests")}</TableHead>
                <TableHead>{t("Rooms")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Website")}</TableHead>
                <TableHead className="w-10"><span className="sr-only">{t("Edit")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((rt) => (
                <TableRow key={rt.id}>
                  <TableCell className="font-medium">{rt.name}{(typeZh[rt.id]?.values.name || typeZh[rt.id]?.hints.name) && <span lang="zh-CN" className="ml-2 text-xs font-normal text-muted-foreground">{typeZh[rt.id].values.name || typeZh[rt.id].hints.name}</span>}{!rt.isActive && <Badge variant="destructive" className="ml-2">{t("inactive")}</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTZS(rt.baseRate)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">{rt.displayRateUsd ? `$${rt.displayRateUsd}` : "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{t.plural(rt.maxAdults, "{n} adult", "{n} adults")}{rt.maxChildren ? ` + ${t.plural(rt.maxChildren, "{n} child", "{n} children")}` : ""}</TableCell>
                  <TableCell className="tabular-nums">{rt._count.rooms}</TableCell>
                  <TableCell className="hidden md:table-cell">{rt.isPublic ? t("Shown") : t("Hidden")}</TableCell>
                  <TableCell>
                    <RoomTypeDialog
                      canPrice={can(user, "pricing.manage")}
                      amenities={amenities.map((a) => ({ id: a.id, name: t(a.name) }))}
                      zh={typeZh[rt.id]}
                      type={{
                        id: rt.id, name: rt.name, baseRate: rt.baseRate, displayRateUsd: rt.displayRateUsd ?? "",
                        maxAdults: rt.maxAdults, maxChildren: rt.maxChildren, bedType: rt.bedType ?? "", sizeSqm: rt.sizeSqm ?? "",
                        shortDescription: rt.shortDescription ?? "", description: rt.description ?? "",
                        images: (rt.images as string[]).join("\n"), isPublic: rt.isPublic, isActive: rt.isActive,
                        amenityIds: rt.amenities.map((a) => a.amenityId),
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
          <CardTitle>{t("Rooms")}</CardTitle>
          <CardDescription>{t("Meeting Room 32 is managed separately and is not part of guest-room inventory.")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-stack>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Room")}</TableHead>
                <TableHead>{t("Type")}</TableHead>
                <TableHead className="hidden sm:table-cell">{t("Floor")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead className="w-10"><span className="sr-only">{t("Edit")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r) => (
                <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                  <TableCell className="font-medium tabular-nums">{r.number}</TableCell>
                  <TableCell>{t(r.roomType.name)}</TableCell>
                  <TableCell className="hidden sm:table-cell">{r.floor ?? "—"}</TableCell>
                  <TableCell>{r.isActive ? t(ROOM_STATUS_META[r.status].label) : <Badge variant="outline">{t("Removed")}</Badge>}</TableCell>
                  <TableCell>
                    <RoomDialog types={typeOptions} room={{ id: r.id, number: r.number, roomTypeId: r.roomTypeId, floor: r.floor ?? "", notes: r.notes ?? "", isActive: r.isActive }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Amenities")}</CardTitle>
          <CardDescription>{t("Their Chinese for Chinese guests. Leave a name empty to show the default Chinese (in grey) — or the English when there is none.")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/60 p-0">
          {amenities.map((a) => <AmenityChinese key={a.id} id={a.id} name={a.name} form={amenityZh[a.id]} />)}
        </CardContent>
      </Card>
    </div>
  );
}
