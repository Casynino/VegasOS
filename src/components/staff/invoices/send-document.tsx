"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Mail, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { logSendAction } from "@/app/staff/(app)/invoices/actions";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";

/** WhatsApp wants the number as digits with the country code: 0712… → 255712…. */
const waDigits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `255${d.slice(1)}` : d;
};

/** What is being sent, in the reader's words ("invoice INV-0012", "statement STM-…", "thank-you note (v2)"); the history keeps the English. */
function whatLabel(what: string, t: T) {
  let m = /^invoice (.+)$/.exec(what);
  if (m) return t("invoice {number}", { number: m[1] });
  m = /^statement (.+)$/.exec(what);
  if (m) return t("statement {number}", { number: m[1] });
  m = /^thank-you note \(v(\d+)\)$/.exec(what);
  if (m) return t("thank-you note (v{version})", { version: m[1] });
  return what;
}

/**
 * Send an invoice or statement to the billing contact: a ready message on
 * WhatsApp or email (opened on this device, with the print/PDF attached by
 * staff), or copy the text. Each send is written to the history.
 */
export function SendDocument({ entity, what, to, subject, text, label }: {
  entity: { type: "Invoice" | "BookingGroup" | "Reservation"; id: string }; what: string;
  /** Button label (default "Send"). */
  label?: string;
  to: { name: string; phone?: string | null; email?: string | null };
  subject: string; text: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(to.phone ?? "");
  const [email, setEmail] = useState(to.email ?? "");
  const [body, setBody] = useState(text);
  const log = (channel: "WHATSAPP" | "EMAIL" | "COPY", dest?: string) => { void logSendAction({ entityType: entity.type, entityId: entity.id, channel, to: dest, what, body }); };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}><Send />{label ?? t("Send")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader icon={<Send />} eyebrow={t("Billing")} tone="emerald">
            <DialogTitle>{t("Send {what} to {name}", { what: whatLabel(what, t), name: to.name })}</DialogTitle>
            <DialogDescription>{t("Opens WhatsApp or your email with the message ready — nothing is sent until you press send there. To attach the full document, use Print → Save as PDF.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t("Message")} className="text-sm" />
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("WhatsApp number")} inputMode="tel" aria-label={t("WhatsApp number")} />
              <Button disabled={waDigits(phone).length < 9} onClick={() => { log("WHATSAPP", phone); window.open(`https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(body)}`, "_blank", "noopener"); }}>
                <MessageCircle />WhatsApp
              </Button>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("Email")} aria-label={t("Email")} />
              <Button variant="outline" disabled={!/.+@.+\..+/.test(email)} onClick={() => { log("EMAIL", email); window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; }}>
                <Mail />{t("Email")}
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={async () => { await navigator.clipboard.writeText(body); log("COPY"); toast.success(t("Message copied.")); }}><Copy />{t("Copy the message")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
