"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ImagePlus, Layers, Loader2, Pencil, Plus, UtensilsCrossed } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { moveMenuCategoryAction, saveMenuCategoryAction, saveMenuItemAction, setAvailableAction } from "../actions";

type Cat = { id: string; name: string };
export type EditableItem = { id: string; categoryId: string; name: string; description: string | null; price: number; subcategory: string | null; isAvailable: boolean; isActive: boolean; isFeatured: boolean; image: string | null };

/** Add or edit a menu item — name, category, price, photo, available / on the menu. */
export function MenuItemButton({ item, categories, defaultCategory }: { item?: EditableItem; categories: Cat[]; defaultCategory?: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState("");
  const router = useRouter();
  const key = item?.id ?? "new";
  return (
    <>
      {item
        ? <Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs" onClick={() => setOpen(true)}><Pencil className="size-3.5" />Edit</Button>
        : <Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2.5 text-xs" onClick={() => setOpen(true)}><Plus className="size-3.5" />Add item</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<UtensilsCrossed />} eyebrow="Menu" tone="gold">
            <DialogTitle>{item ? `Edit ${item.name}` : "Add a menu item"}</DialogTitle>
            <DialogDescription>Price changes apply to new orders only — orders already placed keep the price they were charged.</DialogDescription>
          </DialogHeader>
          <ActionForm action={saveMenuItemAction} onSuccess={() => { setOpen(false); setFile(""); router.refresh(); }} className="space-y-3">
            {({ pending, fieldErrors: e }) => (
              <>
                {item && <input type="hidden" name="id" value={item.id} />}
                <div className="space-y-1.5"><Label htmlFor={`n-${key}`}>Name</Label><Input id={`n-${key}`} name="name" defaultValue={item?.name} required /><FieldError message={e?.name} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor={`c-${key}`}>Category</Label>
                    <NativeSelect id={`c-${key}`} name="categoryId" defaultValue={item?.categoryId ?? defaultCategory ?? categories[0]?.id}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
                  <div className="space-y-1.5"><Label htmlFor={`p-${key}`}>Price (TZS)</Label>
                    <Input id={`p-${key}`} name="price" type="number" inputMode="numeric" min={1} step={500} defaultValue={item?.price} className="text-base font-semibold tabular-nums" required /><FieldError message={e?.price} /></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor={`d-${key}`}>Short description</Label><Textarea id={`d-${key}`} name="description" rows={2} defaultValue={item?.description ?? ""} placeholder="What makes it good — shown on the website menu" /></div>
                <div className="space-y-1.5"><Label htmlFor={`s-${key}`}>Sub-group (optional)</Label><Input id={`s-${key}`} name="subcategory" defaultValue={item?.subcategory ?? ""} placeholder="e.g. Red wine, Vodka, Vegetarian" /></div>
                <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-border p-3 text-sm hover:bg-muted/40">
                  {item?.image && !file
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={item.image} alt="" className="size-14 rounded-xl object-cover" />
                    : <span className="grid size-14 place-items-center rounded-xl bg-muted"><ImagePlus className="size-5 text-muted-foreground" /></span>}
                  <span className="min-w-0"><span className="block font-medium">{item?.image ? "Change photo" : "Add a photo"}</span><span className="block truncate text-xs text-muted-foreground">{file || "JPG, PNG or WebP · up to 8 MB"}</span></span>
                  <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(ev) => setFile(ev.target.files?.[0]?.name ?? "")} />
                </label>
                <div className="space-y-2 rounded-2xl border border-border/70 p-3">
                  <NativeCheckbox name="isAvailable" defaultChecked={item?.isAvailable ?? true} label={<><strong>Available</strong> — untick when sold out; it stays on the menu as not available</>} />
                  <NativeCheckbox name="isActive" defaultChecked={item?.isActive ?? true} label={<><strong>On the menu</strong> — untick to hide it everywhere</>} />
                  <NativeCheckbox name="isFeatured" defaultChecked={item?.isFeatured ?? false} label={<><strong>Featured</strong> — shown first under &ldquo;Recommended&rdquo; when customers order</>} />
                </div>
                <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{item ? "Save" : "Add to the menu"}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Available / sold out, in one tap. */
export function AvailableToggle({ id, isAvailable }: { id: string; isAvailable: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => {
      const res = await setAvailableAction({ id, isAvailable: !isAvailable });
      if (res.ok) router.refresh(); else toast.error(res.error);
    })} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold transition", isAvailable ? "bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300" : "bg-rose-500/12 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300")}>
      {pending ? "…" : isAvailable ? "Available" : "Sold out"}
    </button>
  );
}

export function CategoryButton({ category }: { category?: { id: string; name: string; type: string; revenueKind: string; description: string | null; isActive: boolean } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const key = category?.id ?? "new";
  return (
    <>
      {category
        ? <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-lg px-2 text-xs" onClick={() => setOpen(true)}><Pencil className="size-3.5" />Edit</Button>
        : <Button variant="outline" onClick={() => setOpen(true)}><Plus />Category</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Layers />} eyebrow="Menu" tone="gold"><DialogTitle>{category ? `Edit ${category.name}` : "Add a category"}</DialogTitle><DialogDescription>Categories group the menu on the website and on the order screen.</DialogDescription></DialogHeader>
          <ActionForm action={saveMenuCategoryAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-3">
            {({ pending, fieldErrors: e }) => (
              <>
                {category && <input type="hidden" name="id" value={category.id} />}
                <div className="space-y-1.5"><Label htmlFor={`cn-${key}`}>Name</Label><Input id={`cn-${key}`} name="name" defaultValue={category?.name} required /><FieldError message={e?.name} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label htmlFor={`ct-${key}`}>Food or drink</Label><NativeSelect id={`ct-${key}`} name="type" defaultValue={category?.type ?? "FOOD"}><option value="FOOD">Food</option><option value="DRINK">Drink</option></NativeSelect></div>
                  <div className="space-y-1.5"><Label htmlFor={`ck-${key}`}>Counts as</Label><NativeSelect id={`ck-${key}`} name="revenueKind" defaultValue={category?.revenueKind ?? "RESTAURANT"}><option value="RESTAURANT">Restaurant income</option><option value="BAR">Bar income</option></NativeSelect></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor={`cd-${key}`}>Short line for the website</Label><Input id={`cd-${key}`} name="description" defaultValue={category?.description ?? ""} /></div>
                <NativeCheckbox name="isActive" defaultChecked={category?.isActive ?? true} label="Show this category" />
                <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MoveCategory({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const move = (dir: -1 | 1) => start(async () => { const res = await moveMenuCategoryAction({ id, dir }); if (res.ok) router.refresh(); else toast.error(res.error); });
  return (
    <span className="flex">
      <button type="button" disabled={pending} onClick={() => move(-1)} aria-label="Move up" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><ArrowUp className="size-3.5" /></button>
      <button type="button" disabled={pending} onClick={() => move(1)} aria-label="Move down" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><ArrowDown className="size-3.5" /></button>
    </span>
  );
}
