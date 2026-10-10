"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Languages, Link2, Mail, MessageCircle, MessageSquareText, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { logGuestMessageAction } from "@/app/staff/(app)/guests/actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import { hasCjk, LOCALE_META, toLocale } from "@/i18n/config";

export type GuestMessageOption = {
  type: "BOOKING_CREATED" | "BOOKING_UPDATED" | "BOOKING_CANCELLED" | "WELCOME" | "THANK_YOU" | "PAYMENT" | "PAYMENT_RECEIVED";
  label: string; text: string; subject: string;
};
type Sent = { type: string; channel: string; at: string; by: string | null };

const waDigits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `255${d.slice(1)}` : d;
};
const CHANNEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: msg("Email"), COPY: msg("Copied"), CALL: msg("Call") };
/** The text without the guest's own name (a Chinese name in an English message is still English). */
const withoutName = (text: string, name: string) => name.split(/\s+/).filter(Boolean).reduce((x, w) => x.replaceAll(w, ""), text);

/**
 * "Message the guest": the booking details, the welcome (Wi-Fi, menu link) or the
 * thank-you note — ready to send on WhatsApp, SMS or email from this device.
 * Every send is kept on the guest's profile. The messages come written in the guest's own language — a small hint
 * says which, so reception knows before sending.
 */
export function GuestMessenger({ reservationId, guest, options, link, sent, autoOpen = null, language }: {
  reservationId: string; guest: { name: string; phone: string | null; email: string | null };
  options: GuestMessageOption[]; link: string; sent: Sent[];
  /** Open straight away with this message (e.g. right after the booking was saved). */
  autoOpen?: GuestMessageOption["type"] | null;
  /** The language the messages are written in (the guest's); worked out from the text when not given. */
  language?: string | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(!!autoOpen && options.some((o) => o.type === autoOpen));
  const [type, setType] = useState<GuestMessageOption["type"]>(autoOpen && options.some((o) => o.type === autoOpen) ? autoOpen : options[0]?.type ?? "BOOKING_CREATED");
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(options.map((o) => [o.type, o.text])));
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [email, setEmail] = useState(guest.email ?? "");
  const [copied, setCopied] = useState(false);
  const current = options.find((o) => o.type === type) ?? options[0];
  const body = texts[type] ?? "";
  const last = (k: string) => sent.find((s) => s.type === k);
  // "Messages in 中文" — the guest's language (or, when not given, what the text is written in).
  const lang = toLocale(language) ?? (options.some((o) => hasCjk(withoutName(o.text, guest.name))) ? "zh-CN" : "en");
  const langHint = t("Messages in {language}", { language: LOCALE_META[lang].label });

  const log = (channel: "WHATSAPP" | "SMS" | "EMAIL" | "COPY", to?: string) =>
    void logGuestMessageAction({ reservationId, type, channel, to, body }).then((r) => { if (r.ok) toast.success(t("{message} — logged on {name}'s profile.", { message: t(current.label), name: guest.name })); });
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
                <span className="block text-sm font-medium">{t(o.label)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s ? `${t("Sent")} · ${t(CHANNEL[s.channel] ?? s.channel)} · ${new Date(s.at).toLocaleString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${s.by ? ` · ${s.by}` : ""}` : t("Not sent yet")}
                </span>
              </span>
              <Send className="size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          {copied ? <Check className="size-3.5 text-emerald-600" /> : <Link2 className="size-3.5" />}
          <span className="truncate">{copied ? t("Guest link copied") : t("Copy the guest's stay link (booking + menu)")}</span>
        </button>
        <p className="flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground"><Languages className="size-3.5" />{langHint}</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader icon={<MessageSquareText />} eyebrow={t("Reception")} tone="sky">
            <DialogTitle>{t("Message {name}", { name: guest.name })}</DialogTitle>
            <DialogDescription>{t("Opens WhatsApp, SMS or email with the message ready — it is sent when you press send there.")}</DialogDescription>
          </DialogHeader>
          {options.length > 1 && (
            <div className="grid gap-1 rounded-xl bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
              {options.map((o) => (
                <button key={o.type} type="button" onClick={() => setType(o.type)}
                  className={cn("truncate rounded-lg px-2 py-1.5 text-xs font-medium transition-colors", type === o.type ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(o.label)}</button>
              ))}
            </div>
          )}
          <p className="-mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Languages className="size-3.5" />{langHint}</p>
          <Textarea rows={10} value={body} onChange={(e) => setTexts((all) => ({ ...all, [type]: e.target.value }))} aria-label={t("Message")} className="text-sm leading-relaxed" />
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("Guest phone")} inputMode="tel" aria-label={t("Guest phone")} className="flex-1" />
              <Button className="bg-[#25D366] text-[#073b1f] hover:bg-[#1fbe5b]" disabled={waDigits(phone).length < 9}
                onClick={() => { log("WHATSAPP", phone); window.open(`https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(body)}`, "_blank", "noopener"); }}>
                <MessageCircle />WhatsApp
              </Button>
              <Button variant="outline" disabled={waDigits(phone).length < 9} onClick={() => { log("SMS", phone); window.location.href = `sms:+${waDigits(phone)}?&body=${encodeURIComponent(body)}`; }} aria-label={t("Send as SMS")}>
                <Smartphone />SMS
              </Button>
            </div>
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("Guest email")} aria-label={t("Guest email")} className="flex-1" />
              <Button variant="outline" disabled={!/.+@.+\..+/.test(email)} onClick={() => { log("EMAIL", email); window.location.href = `mailto:${email}?subject=${encodeURIComponent(current.subject)}&body=${encodeURIComponent(body)}`; }}>
                <Mail />{t("Email")}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={async () => { await navigator.clipboard.writeText(body); log("COPY"); }}><Copy />{t("Copy the message")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
