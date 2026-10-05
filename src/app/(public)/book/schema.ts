import { z } from "zod";
import { addDays, isBusinessDate } from "@/lib/time/business-date";
import { MAX_ADULTS, MAX_CHILDREN, MAX_ROOMS_PER_BOOKING } from "@/server/services/public-booking";

const date = (label: string) => z.string().refine((v) => isBusinessDate(v), `Choose a valid ${label} date.`);

export const selectionSchema = z.object({
  checkIn: date("check-in"),
  checkOut: date("check-out"),
  adults: z.coerce.number().int().min(1).max(MAX_ADULTS),
  children: z.coerce.number().int().min(0).max(MAX_CHILDREN),
  type: z.string().regex(/^[a-z0-9-]{1,80}$/, "Choose a room type."),
  rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_BOOKING),
});

export const guestSchema = z.object({
  /** Blank for a returning guest (found by their phone): the name we have is used — see the booking actions. */
  fullName: z.union([z.literal(""), z.string().trim().min(2, "Please enter your full name.").max(120, "Name is too long.")]).optional(),
  phone: z
    .string()
    .trim()
    .min(1, "Please enter a phone number so we can reach you.")
    .max(30, "Phone number is too long.")
    .regex(/^\+?[\d\s().-]{7,}$/, "Enter a valid phone number, e.g. +255 7XX XXX XXX."),
  email: z.union([z.literal(""), z.email("Enter a valid email address.").max(160)]).optional(),
  nationality: z.string().trim().max(60, "Too long.").optional(),
  specialRequests: z.string().trim().max(1000, "Please keep requests under 1,000 characters.").optional(),
  /** Optional (owner, 2026-10-05: booking as easy as ordering food). */
  expectedArrivalTime: z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time like 14:30.")]).optional(),
  /** Honeypot: real people never see or fill this field. */
  company: z.string().max(0).optional(),
});

export const pickupSchema = z.object({
  pickup: z.enum(["", "no", "yes"]).optional(),
  flightNumber: z.string().trim().max(20, "Flight number is too long.").optional(),
  pickupDate: z.string().optional(),
  pickupTime: z.string().optional(),
  airport: z.string().trim().max(120, "Too long.").optional(),
  passengers: z.union([z.literal(""), z.coerce.number().int().min(1, "At least 1 passenger.").max(20, "Up to 20 passengers.")]).optional(),
  pickupNotes: z.string().trim().max(500, "Please keep instructions under 500 characters.").optional(),
});

export const bookingSchema = selectionSchema
  .extend(guestSchema.shape)
  .extend(pickupSchema.shape)
  .superRefine((v, ctx) => {
    if (v.pickup !== "yes") return;
    if (!v.flightNumber) ctx.addIssue({ code: "custom", path: ["flightNumber"], message: "Enter your flight number." });
    if (!v.pickupDate || !isBusinessDate(v.pickupDate)) {
      ctx.addIssue({ code: "custom", path: ["pickupDate"], message: "Choose your arrival date." });
    } else if (isBusinessDate(v.checkIn) && isBusinessDate(v.checkOut) && (v.pickupDate < addDays(v.checkIn, -1) || v.pickupDate > v.checkOut)) {
      ctx.addIssue({ code: "custom", path: ["pickupDate"], message: "Arrival date should be around your check-in date." });
    }
    if (!v.pickupTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.pickupTime)) {
      ctx.addIssue({ code: "custom", path: ["pickupTime"], message: "Enter your arrival time (e.g. 14:30)." });
    }
  });
export type BookingInput = z.infer<typeof bookingSchema>;
