import type { InvoiceDoc } from "./invoice-document";

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
export const taxLine = (x: TaxInfo) => [x.taxId && `TIN ${x.taxId}`, x.vrn && `VRN ${x.vrn}`, x.registrationNo && `Reg. No. ${x.registrationNo}`].filter(Boolean).join("  ·  ") || null;

/** A company account as the invoice addresses it. */
export function companyBillTo(c: CompanyProfile): InvoiceDoc["billTo"] {
  return {
    name: c.companyName, attn: c.contactPerson ?? null, lines: addressLines(c.billingAddress || c.address), tax: taxLine(c),
    contact: [c.phone, c.email].filter(Boolean).join("  ·  ") || null, note: c.billingNotes ?? null,
  };
}

/**
 * A group invoice goes to the billing party — the group's company, or the group
 * itself (its name, address and tax details) — with the group's contact person.
 * Never to the individual guests: they appear room by room inside the invoice.
 */
export function groupBillTo(g: GroupProfile, company: CompanyProfile | null): InvoiceDoc["billTo"] {
  const person = { name: g.contactGuest.fullName, phone: g.contactGuest.phone ?? null, email: g.contactGuest.email ?? null };
  if (company) return { ...companyBillTo(company), attn: null, person, note: [company.billingNotes, g.billingNotes].filter(Boolean).join(" · ") || null };
  return {
    name: g.name, lines: addressLines(g.billingAddress || g.address), tax: taxLine(g),
    contact: g.billingEmail ?? null, person, note: g.billingNotes ?? null,
  };
}
