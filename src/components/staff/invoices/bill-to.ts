import type { InvoiceDoc } from "./invoice-document";
import { englishT, type T } from "@/i18n/translate";

type TaxInfo = { taxId?: string | null; vrn?: string | null; registrationNo?: string | null };
type CompanyProfile = TaxInfo & {
  companyName: string; contactPerson?: string | null; address?: string | null; billingAddress?: string | null;
  phone?: string | null; email?: string | null; billingNotes?: string | null;
};
type GroupProfile = TaxInfo & {
  name: string; address?: string | null; billingAddress?: string | null; billingEmail?: string | null; billingNotes?: string | null;
  contactGuest: { fullName: string; phone?: string | null; email?: string | null };
};

const addressLines = (a?: string | null) => (a ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
/** "TIN … · VRN … · Reg. No. …" — the labels in the reader's language when their `t` is given (English otherwise). */
export const taxLine = (x: TaxInfo, t: T = englishT) => [x.taxId && t("TIN {id}", { id: x.taxId }), x.vrn && t("VRN {id}", { id: x.vrn }), x.registrationNo && t("Reg. No. {id}", { id: x.registrationNo })].filter(Boolean).join("  ·  ") || null;

/** A company account as the invoice addresses it. */
export function companyBillTo(c: CompanyProfile, t: T = englishT): InvoiceDoc["billTo"] {
  return {
    name: c.companyName, attn: c.contactPerson ?? null, lines: addressLines(c.billingAddress || c.address), tax: taxLine(c, t),
    contact: [c.phone, c.email].filter(Boolean).join("  ·  ") || null, note: c.billingNotes ?? null,
  };
}

/**
 * A group invoice goes to the billing party — the group's company, or the group
 * itself (its name, address and tax details) — with the group's contact person.
 * Never to the individual guests: they appear room by room inside the invoice.
 */
export function groupBillTo(g: GroupProfile, company: CompanyProfile | null, t: T = englishT): InvoiceDoc["billTo"] {
  const person = { name: g.contactGuest.fullName, phone: g.contactGuest.phone ?? null, email: g.contactGuest.email ?? null };
  if (company) return { ...companyBillTo(company, t), attn: null, person, note: [company.billingNotes, g.billingNotes].filter(Boolean).join(" · ") || null };
  return {
    name: g.name, lines: addressLines(g.billingAddress || g.address), tax: taxLine(g, t),
    contact: g.billingEmail ?? null, person, note: g.billingNotes ?? null,
  };
}
