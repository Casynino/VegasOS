import { msg } from "@/i18n/msg";

/** A company's employee: a guest linked to the company, offered when booking for it. ID is optional until check-in. */
export type CompanyStaff = { id: string; fullName: string; phone: string | null; idType: string | null; idNumber: string | null };

/** A company as the booking forms need it: terms, credit left (null = no limit) and its staff. */
export type BookingCompany = {
  id: string; companyName: string; terms: number; available: number | null; staff: CompanyStaff[];
  /** Company, family, organization… — the group form lists each type's own accounts. */
  kind: "COMPANY" | "FAMILY" | "ORGANIZATION" | "GOVERNMENT" | "EVENT" | "OTHER";
  /** The account's contact person — the group's contact when this company pays. */
  contact: { name: string | null; phone: string | null; email: string | null };
};

export const ID_TYPES = [["NATIONAL_ID", msg("NIDA")], ["PASSPORT", msg("Passport")], ["DRIVING_LICENCE", msg("Driving licence")], ["VOTER_ID", msg("Voter ID")], ["OTHER", msg("Other")]] as const;
export const idLabel = (type: string | null | undefined) => ID_TYPES.find(([v]) => v === type)?.[1] ?? msg("ID");
