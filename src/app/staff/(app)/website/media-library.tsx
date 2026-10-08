"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Eye, EyeOff, ImageIcon, ImageUp, Loader2, Star, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { moveMediaAction, updateMediaAction, uploadMediaAction } from "./actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Item = {
  id: string; src: string; title: string; altText: string; description: string; category: string; roomTypeId: string; roomTypeName: string | null;
  isFeatured: boolean; isActive: boolean; isIllustrative: boolean; creditText: string;
};
const CATEGORY_LABEL: Record<string, string> = {
  ROOMS: msg("Rooms"), BATHROOMS: msg("Bathrooms"), EXTERIOR: msg("Exterior"), RECEPTION: msg("Reception"), RESTAURANT: msg("Restaurant"), BAR: msg("Bar"),
  BREAKFAST: msg("Breakfast"), MEETING_ROOM: msg("Meeting room"), FACILITIES: msg("Facilities"), EXPERIENCE: msg("Hotel experience"), OTHER: msg("Other"),
};

export function MediaLibrary({ items, roomTypes }: { items: Item[]; roomTypes: { id: string; name: string }[] }) {
  const t = useT();
  const [filter, setFilter] = useState<string>("ALL");
  const shown = useMemo(() => items.filter((i) => filter === "ALL" || (filter.startsWith("RT:") ? i.roomTypeId === filter.slice(3) : i.category === filter)), [items, filter]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" aria-label={t("Filter")}>
          <option value="ALL">{t("All photos")}</option>
          <optgroup label={t("Room type galleries")}>{roomTypes.map((rt) => <option key={rt.id} value={`RT:${rt.id}`}>{t(rt.name)}</option>)}</optgroup>
          <optgroup label={t("Categories")}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</optgroup>
        </NativeSelect>
        <span className="text-sm text-muted-foreground">{t.plural(shown.length, "{n} photo", "{n} photos")}{filter.startsWith("RT:") && ` — ${t("order here is the order on the room page")}`}</span>
        <div className="ml-auto"><UploadDialog roomTypes={roomTypes} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((m) => <MediaCard key={m.id} item={m} roomTypes={roomTypes} />)}
      </div>
    </div>
  );
}

function MediaCard({ item: m, roomTypes }: { item: Item; roomTypes: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: m.title, altText: m.altText, category: m.category, roomTypeId: m.roomTypeId });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (r.ok) router.refresh(); else toast.error(r.error); });
  return (
    <figure className={cn("group overflow-hidden rounded-xl border bg-card", !m.isActive && "opacity-50")}>
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.src} alt={m.altText} loading="lazy" className="aspect-[4/3] w-full object-cover" />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {m.isFeatured && <Badge className="bg-[oklch(0.72_0.12_80)] text-black">{t("Featured")}</Badge>}
          {m.isIllustrative && <Badge variant="secondary">{t("Illustrative")}</Badge>}
        </div>
        {pending && <Loader2 className="absolute right-2 top-2 size-4 animate-spin text-white" />}
      </div>
      <figcaption className="space-y-1.5 p-2 text-xs">
        <p className="truncate font-medium">{m.title}</p>
        <p className="truncate text-muted-foreground">{t(CATEGORY_LABEL[m.category] ?? m.category)}{m.roomTypeName && ` · ${t(m.roomTypeName)}`}</p>
        <div className="flex items-center gap-0.5">
          <Button size="icon-xs" variant="ghost" aria-label={t("Move earlier")} onClick={() => run(() => moveMediaAction({ id: m.id, direction: -1 }))}><ArrowUp /></Button>
          <Button size="icon-xs" variant="ghost" aria-label={t("Move later")} onClick={() => run(() => moveMediaAction({ id: m.id, direction: 1 }))}><ArrowDown /></Button>
          <Button size="icon-xs" variant="ghost" aria-label={m.isFeatured ? t("Unfeature") : t("Feature")} onClick={() => run(() => updateMediaAction({ id: m.id, isFeatured: !m.isFeatured }))}><Star className={m.isFeatured ? "fill-current" : ""} /></Button>
          <Button size="icon-xs" variant="ghost" aria-label={m.isActive ? t("Hide from website") : t("Show on website")} onClick={() => run(() => updateMediaAction({ id: m.id, isActive: !m.isActive }))}>{m.isActive ? <Eye /> : <EyeOff />}</Button>
          <Dialog open={edit} onOpenChange={setEdit}>
            <DialogTrigger render={<Button size="xs" variant="outline" className="ml-auto" />}>{t("Edit")}</DialogTrigger>
            <DialogContent>
              <DialogHeader icon={<ImageIcon />} eyebrow={t("Website")} tone="violet"><DialogTitle>{t("Photo details")}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1"><Label>{t("Title")}</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
                <div className="space-y-1"><Label>{t("Alt text (describes the photo)")}</Label><Input value={f.altText} onChange={(e) => setF({ ...f, altText: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>{t("Category")}</Label>
                    <NativeSelect value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</NativeSelect></div>
                  <div className="space-y-1"><Label>{t("Room type gallery")}</Label>
                    <NativeSelect value={f.roomTypeId} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}><option value="">{t("None")}</option>{roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{t(rt.name)}</option>)}</NativeSelect></div>
                </div>
              </div>
              <DialogFooter><Button disabled={pending} onClick={() => { setEdit(false); run(() => updateMediaAction({ id: m.id, title: f.title, altText: f.altText, category: f.category as never, roomTypeId: f.roomTypeId || null })); }}>{t("Save")}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </figcaption>
    </figure>
  );
}

function UploadDialog({ roomTypes }: { roomTypes: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [illustrative, setIllustrative] = useState(false);
  function readDims(file?: File | null) {
    if (!file) return setDims(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setDims({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.src = url;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Upload /> {t("Upload photo")}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader icon={<ImageUp />} eyebrow={t("Website")} tone="violet"><DialogTitle>{t("Upload photo")}</DialogTitle>
          <DialogDescription>{t("Use real Vegas Luxury Hotel photos. JPG/PNG/WebP, up to 8 MB — around 2000 px wide is ideal.")}</DialogDescription></DialogHeader>
        <ActionForm action={uploadMediaAction} onSuccess={() => { setOpen(false); setDims(null); router.refresh(); }} className="space-y-3">
          {({ pending, fieldErrors: e }) => (
            <>
              <Input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(ev) => readDims(ev.target.files?.[0])} className="py-1.5" />
              <FieldError message={e?.file} />
              {dims && <><input type="hidden" name="width" value={dims.w} /><input type="hidden" name="height" value={dims.h} /><p className="text-xs text-muted-foreground">{dims.w} × {dims.h}px{dims.w < 1200 && ` — ${t("small; may look soft on large screens")}`}</p></>}
              <div className="space-y-1"><Label htmlFor="ut">{t("Title")}</Label><Input id="ut" name="title" placeholder={t("e.g. Double Deluxe — seating area")} /></div>
              <div className="space-y-1"><Label htmlFor="ua">{t("Alt text (what the photo shows)")}</Label><Input id="ua" name="altText" /><FieldError message={e?.altText} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="uc">{t("Category")}</Label>
                  <NativeSelect id="uc" name="category" defaultValue="ROOMS">{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</NativeSelect>
                  <FieldError message={e?.category} /></div>
                <div className="space-y-1"><Label htmlFor="ur">{t("Room type gallery")}</Label>
                  <NativeSelect id="ur" name="roomTypeId" defaultValue=""><option value="">{t("None")}</option>{roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{t(rt.name)}</option>)}</NativeSelect></div>
              </div>
              <NativeCheckbox name="isIllustrative" checked={illustrative} onChange={(ev) => setIllustrative(ev.target.checked)}
                label={t("Illustrative image (not a photo of this hotel) — shown labelled, never in the hotel gallery")} />
              {illustrative && <div className="space-y-1"><Label htmlFor="ucr">{t("Credit / source")}</Label><Input id="ucr" name="creditText" placeholder={t("Photographer, source & licence")} /><FieldError message={e?.creditText} /></div>}
              <DialogFooter><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Upload")}</Button></DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
