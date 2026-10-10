import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getEditableContent } from "@/server/services/site-content";
import { mediaUrl } from "@/server/services/media";
import { PUBLIC_ICON_NAMES } from "@/components/public/icon";
import { PageHeader } from "@/components/staff/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContentEditor } from "./content-editor";
import { MediaLibrary } from "./media-library";
import { ServicesEditor } from "./services-editor";
import { getT } from "@/i18n/server";
import { translationForms } from "@/server/services/translations";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Website") };
}

export default async function WebsitePage() {
  await requirePagePermission("website.manage");
  const t = await getT();
  const [sections, media, roomTypes, services] = await Promise.all([
    getEditableContent(),
    db.mediaAsset.findMany({ orderBy: [{ category: "asc" }, { roomTypeId: "asc" }, { sortOrder: "asc" }], include: { roomType: { select: { name: true } } } }),
    db.roomType.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.hotelService.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const serviceZh = await translationForms("hotelService", services);
  const mediaItems = media.map((m) => ({
    id: m.id, src: mediaUrl(m), title: m.title, altText: m.altText, description: m.description ?? "", category: m.category,
    roomTypeId: m.roomTypeId ?? "", roomTypeName: m.roomType?.name ?? null, isFeatured: m.isFeatured, isActive: m.isActive,
    isIllustrative: m.isIllustrative, creditText: m.creditText ?? "",
  }));

  return (
    <div className="w-full">
      <PageHeader eyebrow={t("Content management")} title={t("Website")}
        description={t("Change the public website's text, photos and services — in English and Chinese — without a developer. Changes go live immediately and are audited.")}
        actions={<Link href="/" target="_blank" className={buttonVariants({ variant: "outline" })}><ExternalLink /> {t("View website")}</Link>} />
      <Tabs defaultValue="content">
        <TabsList className="mb-4">
          <TabsTrigger value="content">{t("Text & photos")}</TabsTrigger>
          <TabsTrigger value="media">{t("Media library ({n})", { n: media.filter((m) => m.isActive).length })}</TabsTrigger>
          <TabsTrigger value="services">{t("Services ({n})", { n: services.filter((s) => s.isActive).length })}</TabsTrigger>
        </TabsList>
        <TabsContent value="content">
          <ContentEditor sections={JSON.parse(JSON.stringify(sections))} media={mediaItems.filter((m) => m.isActive)} />
        </TabsContent>
        <TabsContent value="media">
          <MediaLibrary items={mediaItems} roomTypes={roomTypes} />
        </TabsContent>
        <TabsContent value="services">
          <ServicesEditor services={services.map((s) => ({ id: s.id, name: s.name, description: s.description ?? "", category: s.category, icon: s.icon ?? "", isActive: s.isActive, isPublic: s.isPublic, isChargeable: s.isChargeable, price: s.price ?? "", priceNote: s.priceNote ?? "", zh: serviceZh[s.id] }))} icons={[...PUBLIC_ICON_NAMES]} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
