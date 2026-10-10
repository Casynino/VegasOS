import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

/**
 * The arrival-day message to the guest. The hotel can set its own text in Settings ({name}, {date}, {hotel}, {checkin},
 * {ref}); the built-in text goes out in the guest's language (their translator, English when left out).
 */
export const DEFAULT_ARRIVAL_REMINDER =
  msg("Hello {name}, this is a reminder that your reservation at {hotel} is today, {date}. Check-in is from {checkin}. We look forward to welcoming you. Ref {ref}.");

export function arrivalReminderText(template: string | null | undefined, v: { name: string; hotel: string; date: string; checkin: string; ref: string }, t: T = englishT) {
  const first = v.name.trim().split(/\s+/)[0] ?? v.name;
  return (template?.trim() || t(DEFAULT_ARRIVAL_REMINDER))
    .replaceAll("{name}", first).replaceAll("{hotel}", v.hotel).replaceAll("{date}", v.date)
    .replaceAll("{checkin}", v.checkin).replaceAll("{ref}", v.ref);
}

/** wa.me link with the message ready — reception sends it from their own WhatsApp. */
export function whatsAppLink(phone: string, text: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
