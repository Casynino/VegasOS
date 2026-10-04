"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ImageIcon, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resetContentAction, saveContentAction } from "./actions";

type Field = { path: string; label: string; type: "text" | "textarea" | "list" | "image"; help?: string; value: unknown; isCustom: boolean };
type Section = { key: string; title: string; fields: Field[] };
type Media = { id: string; src: string; title: string; altText: string; category: string; isIllustrative: boolean };

export function ContentEditor({ sections, media }: { sections: Section[]; media: Media[] }) {
  const [active, setActive] = useState(sections[0]?.key);
  const section = sections.find((s) => s.key === active) ?? sections[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Website sections">
        {sections.map((s) => (
          <button key={s.key} onClick={() => setActive(s.key)}
            className={cn("shrink-0 rounded-lg px-3 py-2 text-left text-sm", s.key === section.key ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {s.title}{s.fields.some((f) => f.isCustom) && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-[oklch(0.72_0.12_80)] align-middle" />}
          </button>
        ))}
      </nav>
      <Card>
        <CardHeader><CardTitle>{section.title}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {section.fields.map((f) => <FieldEditor key={f.path} field={f} media={media} />)}
        </CardContent>
      </Card>
    </div>
  );
}

function FieldEditor({ field, media }: { field: Field; media: Media[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initial = field.type === "list" ? (field.value as string[] | undefined)?.join("\n") ?? "" : field.type === "image" ? "" : String(field.value ?? "");
  const [value, setValue] = useState(initial);
  const [picking, setPicking] = useState(false);
  const img = field.type === "image" ? (field.value as { src: string; alt: string } | undefined) : undefined;
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(r.message ?? "Saved"); router.refresh(); } else toast.error(r.error); });

  return (
    <div className="space-y-1.5 border-b pb-5 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={field.path}>{field.label} {field.isCustom && <Badge variant="outline" className="ml-1">edited</Badge>}</Label>
        {field.isCustom && <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => resetContentAction({ path: field.path }))}><RotateCcw /> Default</Button>}
      </div>
      {field.type === "image" ? (
        <div className="flex items-center gap-3">
          {img?.src && (
            // eslint-disable-next-line @next/next/no-img-element -- CMS preview of arbitrary library images
            <img src={img.src} alt={img.alt} className="h-20 w-32 rounded-lg object-cover" />
          )}
          <Button variant="outline" onClick={() => setPicking(true)}><ImageIcon /> Choose photo</Button>
          <Dialog open={picking} onOpenChange={setPicking}>
            <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-4xl">
              <DialogHeader icon={<ImageIcon />} eyebrow="Website" tone="violet"><DialogTitle>Choose a photo</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {media.map((m) => (
                  <button key={m.id} className="group relative overflow-hidden rounded-lg border text-left focus-visible:ring-3 focus-visible:ring-ring/50 outline-none"
                    onClick={() => { setPicking(false); run(() => saveContentAction({ path: field.path, value: m.id })); }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.src} alt={m.altText} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                    <span className="block truncate px-2 py-1 text-xs">{m.title}{m.isIllustrative && " · illustrative"}</span>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          {field.type === "text" ? <Input id={field.path} value={value} onChange={(e) => setValue(e.target.value)} /> :
            <Textarea id={field.path} rows={field.type === "list" ? 5 : 3} value={value} onChange={(e) => setValue(e.target.value)} />}
          <Button variant="outline" size="icon" aria-label="Save" disabled={pending || value === initial} onClick={() => run(() => saveContentAction({ path: field.path, value }))}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
          </Button>
        </div>
      )}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}
