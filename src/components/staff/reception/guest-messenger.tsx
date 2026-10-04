"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2, Mail, MessageCircle, MessageSquareText, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { logGuestMessageAction } from "@/app/staff/(app)/guests/actions";

export type GuestMessageOption = { type: "BOOKING_CREATED" | "WELCOME" | "THANK_YOU"; label: string; text: string; subject: string };
type Sent = { type: string; channel: string; at: string; by: string | null };

const waDigits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `255${d.slice(1)}` : d;
};
const CHANNEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email", COPY: "Copied", CALL: "Call" };

/**
 * "Message the guest": the booking details, the welcome (Wi-Fi, menu link) or the
 * thank-you note — ready to send on WhatsApp, SMS or email from this device.
 * Every send is kept on the guest's profile.
 */
export function GuestMessenger({ reservationId, guest, options, link, sent, autoOpen = null }: {
  reservationId: string; guest: { name: string; phone: string | null; email: string | null };
  options: GuestMessageOption[]; link: string; sent: Sent[];
  /** Open straight away with this message (e.g. right after the booking was saved). */
  autoOpen?: GuestMessageOption["type"] | null;
}) {
  const [open, setOpen] = useState(!!autoOpen && options.some((o) => o.type === autoOpen));
  const [type, setType] = useState<GuestMessageOption["type"]>(autoOpen && options.some((o) => o.type === autoOpen) ? autoOpen : options[0]?.type ?? "BOOKING_CREATED");
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(options.map((o) => [o.type, o.text])));
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [email, setEmail] = useState(guest.email ?? "");
  const [copied, setCopied] = useState(false);
  const current = options.find((o) => o.type === type) ?? options[0];
  const body = texts[type] ?? "";
  const last = (t: string) => sent.find((s) => s.type === t);

  const log = (channel: "WHATSAPP" | "SMS" | "EMAIL" | "COPY", to?: string) =>
    void logGuestMessageAction({ reservationId, type, channel, to, body }).then((r) => { if (r.ok) toast.success(`${current.label} — logged on ${guest.name}'s profile.`); });
  const pick = (t: GuestMessageOption["type"]) => { setType(t); setOpen(true); };

  return (
    <>
      <div className="space-y-2">
        {options.map((o) => {
          const s = last(o.type);
          return (
            <button key={o.type} type="button" onClick={() => pick(o.type)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border/70 px-3 py-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", s ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-[#25D366]/12 text-[#128C7E] dark:text-[#5fe39a]")}>
                {s ? <Check className="size-4" /> : <MessageCircle className="size-4" />}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{s ? `Sent · ${CHANNEL[s.channel] ?? s.channel} · ${new Date(s.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${s.by ? ` · ${s.by}` : ""}` : "Not sent yet"}</span>
              </span>
              <Send className="size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          {copied ? <Check className="size-3.5 text-emerald-600" /> : <Link2 className="size-3.5" />}
          <span className="truncate">{copied ? "Guest link copied" : "Copy the guest's stay link (booking + menu)"}</span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader icon={<MessageSquareText />} eyebrow="Reception" tone="sky">
            <DialogTitle>Message {guest.name}</DialogTitle>
            <DialogDescription>Opens WhatsApp, SMS or email with the message ready — it is sent when you press send there.</DialogDescription>
          </DialogHeader>
          {options.length > 1 && (
            <div className="grid gap-1 rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
              {options.map((o) => (
                <button key={o.type} type="button" onClick={() => setType(o.type)}
                  className={cn("truncate rounded-lg px-2 py-1.5 text-xs font-medium transition-colors", type === o.type ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{o.label}</button>
              ))}
            </div>
          )}
          <Textarea rows={10} value={body} onChange={(e) => setTexts((t) => ({ ...t, [type]: e.target.value }))} aria-label="Message" className="text-sm leading-relaxed" />
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guest phone" inputMode="tel" aria-label="Guest phone" className="flex-1" />
              <Button className="bg-[#25D366] text-[#073b1f] hover:bg-[#1fbe5b]" disabled={waDigits(phone).length < 9}
                onClick={() => { log("WHATSAPP", phone); window.open(`https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(body)}`, "_blank", "noopener"); }}>
                <MessageCircle />WhatsApp
              </Button>
              <Button variant="outline" disabled={waDigits(phone).length < 9} onClick={() => { log("SMS", phone); window.location.href = `sms:+${waDigits(phone)}?&body=${encodeURIComponent(body)}`; }} aria-label="Send as SMS">
                <Smartphone />SMS
              </Button>
            </div>
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Guest email" aria-label="Guest email" className="flex-1" />
              <Button variant="outline" disabled={!/.+@.+\..+/.test(email)} onClick={() => { log("EMAIL", email); window.location.href = `mailto:${email}?subject=${encodeURIComponent(current.subject)}&body=${encodeURIComponent(body)}`; }}>
                <Mail />Email
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={async () => { await navigator.clipboard.writeText(body); log("COPY"); }}><Copy />Copy the message</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
