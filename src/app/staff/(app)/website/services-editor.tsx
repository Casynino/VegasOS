"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConciergeBell, Loader2, Pencil, Plus } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { saveServiceAction } from "./actions";

type Svc = { id?: string; name: string; description: string; category: string; icon: string; isActive: boolean; isPublic: boolean; isChargeable: boolean; price: number | ""; priceNote: string };

export function ServicesEditor({ services, icons }: { services: Svc[]; icons: string[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Only active, public services appear on the website. Add a service only when the hotel really offers it.</p>
        <ServiceDialog icons={icons} />
      </div>
      <Card><CardContent className="divide-y p-0">
        {services.map((s) => (
          <div key={s.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${s.isActive ? "" : "opacity-50"}`}>
            <div className="min-w-0">
              <p className="font-medium">{s.name}
                {!s.isActive && <Badge variant="outline" className="ml-2">inactive</Badge>}
                {s.isActive && !s.isPublic && <Badge variant="outline" className="ml-2">staff only</Badge>}
                {s.isChargeable && <Badge variant="secondary" className="ml-2">{s.price ? `TZS ${Number(s.price).toLocaleString("en-TZ")}` : s.priceNote || "chargeable"}</Badge>}
              </p>
              <p className="truncate text-sm text-muted-foreground">{s.description}</p>
            </div>
            <ServiceDialog service={s} icons={icons} />
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}

function ServiceDialog({ service, icons }: { service?: Svc; icons: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const s = service ?? { name: "", description: "", category: "CONVENIENCE", icon: "BrushCleaning", isActive: true, isPublic: true, isChargeable: false, price: "" as const, priceNote: "" };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={service ? <Button variant="ghost" size="icon-sm" aria-label={`Edit ${service.name}`} /> : <Button />}>{service ? <Pencil /> : <><Plus /> Add service</>}</DialogTrigger>
      <DialogContent>
        <DialogHeader icon={<ConciergeBell />} eyebrow="Website" tone="violet"><DialogTitle>{service ? service.name : "New service"}</DialogTitle><DialogDescription>Shown on the website and the guest welcome card when active and public.</DialogDescription></DialogHeader>
        <ActionForm action={saveServiceAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="grid gap-3 sm:grid-cols-2">
          {({ pending, fieldErrors: e }) => (
            <>
              {service?.id && <input type="hidden" name="id" value={service.id} />}
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="sn">Name</Label><Input id="sn" name="name" defaultValue={s.name} /><FieldError message={e?.name} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="sd">Description</Label><Textarea id="sd" name="description" rows={2} defaultValue={s.description} /></div>
              <div className="space-y-1"><Label htmlFor="sc">Category</Label>
                <NativeSelect id="sc" name="category" defaultValue={s.category}><option value="DINING">Dining</option><option value="TRANSPORT">Transport</option><option value="CONVENIENCE">Convenience</option><option value="BUSINESS">Business</option><option value="OTHER">Other</option></NativeSelect></div>
              <div className="space-y-1"><Label htmlFor="si">Icon</Label>
                <NativeSelect id="si" name="icon" defaultValue={s.icon}>{icons.map((i) => <option key={i} value={i}>{i}</option>)}</NativeSelect></div>
              <NativeCheckbox name="isActive" defaultChecked={s.isActive} label="Active (the hotel offers this)" />
              <NativeCheckbox name="isPublic" defaultChecked={s.isPublic} label="Show on the website" />
              <NativeCheckbox name="isChargeable" defaultChecked={s.isChargeable} label="Chargeable" className="sm:col-span-2" />
              <div className="space-y-1"><Label htmlFor="sp">Price (TZS, optional)</Label><Input id="sp" name="price" type="number" min={0} defaultValue={s.price} /></div>
              <div className="space-y-1"><Label htmlFor="spn">Price note</Label><Input id="spn" name="priceNote" defaultValue={s.priceNote} placeholder="e.g. on request" /></div>
              <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button></DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
