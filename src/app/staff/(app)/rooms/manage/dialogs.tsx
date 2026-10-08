"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BedDouble, Check, DoorOpen, Loader2, Pencil, Plus } from "lucide-react";
import { useT } from "@/i18n/client";
import { TranslationFields, type TranslationForm } from "@/components/staff/translation-fields";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { saveAmenityChineseAction, saveRoomAction, updateRoomTypeAction } from "../actions";

type TypeOption = { id: string; name: string };

export function RoomDialog({ types, room }: {
  types: TypeOption[];
  room?: { id: string; number: string; roomTypeId: string; floor: number | ""; notes: string; isActive: boolean };
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={room ? <Button variant="ghost" size="icon-sm" aria-label={t("Edit room {room}", { room: room.number })} /> : <Button />}>
        {room ? <Pencil /> : <><Plus /> {t("Add room")}</>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader icon={<DoorOpen />} eyebrow={t("Rooms")} tone="sky">
          <DialogTitle>{room ? t("Room {room}", { room: room.number }) : t("Add room")}</DialogTitle>
          <DialogDescription>{t("Rooms are never deleted — remove one from inventory to keep its history.")}</DialogDescription>
        </DialogHeader>
        <ActionForm action={saveRoomAction} onSuccess={() => setOpen(false)} className="space-y-3">
          {({ pending, fieldErrors: e }) => (
            <>
              {room && <input type="hidden" name="id" value={room.id} />}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="number">{t("Room number")}</Label><Input id="number" name="number" defaultValue={room?.number} required /><FieldError message={e?.number} /></div>
                <div className="space-y-1.5"><Label htmlFor="floor">{t("Floor")}</Label><Input id="floor" name="floor" type="number" defaultValue={room?.floor} /></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="roomTypeId">{t("Room type")}</Label>
                <NativeSelect id="roomTypeId" name="roomTypeId" defaultValue={room?.roomTypeId ?? ""} required>
                  {!room && <option value="" disabled>{t("Choose…")}</option>}
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
                <FieldError message={e?.roomTypeId} />
              </div>
              <div className="space-y-1.5"><Label htmlFor="notes">{t("Notes")}</Label><Input id="notes" name="notes" defaultValue={room?.notes} /></div>
              {room && <NativeCheckbox name="isActive" defaultChecked={room.isActive} label={t("In inventory (untick to remove from sale — history is kept)")} />}
              <DialogFooter><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button></DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function RoomTypeDialog({ type, amenities, canPrice = false, zh }: {
  type: {
    id: string; name: string; baseRate: number; displayRateUsd: number | ""; maxAdults: number; maxChildren: number;
    bedType: string; sizeSqm: number | ""; shortDescription: string; description: string; images: string;
    isPublic: boolean; isActive: boolean; amenityIds: string[];
  };
  amenities: { id: string; name: string }[];
  /** Only Admin sets room prices (Settings → Room pricing). */
  canPrice?: boolean;
  /** Its Chinese (saved + the default as hints). */
  zh?: TranslationForm;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("Edit {name}", { name: type.name })} />}><Pencil /></DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader icon={<BedDouble />} eyebrow={t("Room type")} tone="sky">
          <DialogTitle>{type.name}</DialogTitle>
          <DialogDescription>{t("Rate changes are audited and apply to new bookings only.")}</DialogDescription>
        </DialogHeader>
        <ActionForm action={updateRoomTypeAction} onSuccess={() => setOpen(false)} className="grid gap-3 sm:grid-cols-2">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="id" value={type.id} />
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="name">{t("Name")}</Label><Input id="name" name="name" defaultValue={type.name} required /><FieldError message={e?.name} /></div>
              <div className="space-y-1.5"><Label htmlFor="baseRate">{t("Rate per night (TZS)")}</Label><Input id="baseRate" name="baseRate" type="number" step={1000} min={0} defaultValue={type.baseRate} required readOnly={!canPrice} className={canPrice ? undefined : "opacity-70"} /><FieldError message={e?.baseRate} />{!canPrice && <p className="text-[11px] text-muted-foreground">{t("Set by Admin in Settings → Room pricing.")}</p>}</div>
              <div className="space-y-1.5"><Label htmlFor="displayRateUsd">{t("Indicative USD (website)")}</Label><Input id="displayRateUsd" name="displayRateUsd" type="number" min={0} defaultValue={type.displayRateUsd} /></div>
              <div className="space-y-1.5"><Label htmlFor="maxAdults">{t("Max adults")}</Label><Input id="maxAdults" name="maxAdults" type="number" min={1} defaultValue={type.maxAdults} /></div>
              <div className="space-y-1.5"><Label htmlFor="maxChildren">{t("Max children")}</Label><Input id="maxChildren" name="maxChildren" type="number" min={0} defaultValue={type.maxChildren} /></div>
              <div className="space-y-1.5"><Label htmlFor="bedType">{t("Bed type")}</Label><Input id="bedType" name="bedType" defaultValue={type.bedType} placeholder={t("e.g. 1 double bed")} /></div>
              <div className="space-y-1.5"><Label htmlFor="sizeSqm">{t("Size (m²)")}</Label><Input id="sizeSqm" name="sizeSqm" type="number" defaultValue={type.sizeSqm} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="shortDescription">{t("Short description")}</Label><Input id="shortDescription" name="shortDescription" defaultValue={type.shortDescription} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="description">{t("Description")}</Label><Textarea id="description" name="description" rows={3} defaultValue={type.description} /></div>
              <TranslationFields className="sm:col-span-2" idPrefix={`rt-${type.id}`} form={zh} fields={[
                { name: "name", label: t("Name") }, { name: "shortDescription", label: t("Short description") },
                { name: "description", label: t("Description"), multiline: true }, { name: "bedType", label: t("Bed type") },
              ]} />
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="images">{t("Photos (one path per line, first is the cover)")}</Label>
                <Textarea id="images" name="images" rows={4} defaultValue={type.images} className="font-mono text-xs" />
                <FieldError message={e?.images} />
              </div>
              <fieldset className="sm:col-span-2">
                <legend className="mb-1.5 text-sm font-medium">{t("Amenities")}</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {amenities.map((a) => (
                    <NativeCheckbox key={a.id} name="amenityIds[]" value={a.id} defaultChecked={type.amenityIds.includes(a.id)} label={a.name} />
                  ))}
                </div>
              </fieldset>
              <NativeCheckbox name="isPublic" defaultChecked={type.isPublic} label={t("Show on the website")} />
              <NativeCheckbox name="isActive" defaultChecked={type.isActive} label={t("Active (bookable)")} />
              <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button></DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** One amenity's Chinese name, edited right where it is listed. */
export function AmenityChinese({ id, name, form }: { id: string; name: string; form?: TranslationForm }) {
  const t = useT();
  const router = useRouter();
  const initial = form?.values.name ?? "";
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const r = await saveAmenityChineseAction({ id, name: value });
    if (r.ok) { toast.success(r.message ?? t("Saved")); router.refresh(); } else toast.error(r.error);
  });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
      <label htmlFor={`am-${id}`} className="min-w-40 flex-1 text-sm font-medium">{name}</label>
      <div className="flex w-full items-center gap-2 sm:w-72">
        <Input id={`am-${id}`} lang="zh-CN" value={value} placeholder={form?.hints.name ?? t("Chinese name")} onChange={(e) => setValue(e.target.value)} className="h-9" />
        <Button variant="outline" size="icon" aria-label={t("Save")} disabled={pending || value === initial} onClick={save}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
      </div>
    </div>
  );
}
