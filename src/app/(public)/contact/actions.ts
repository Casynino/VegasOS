"use server";

import { z } from "zod";
import { db } from "@/server/db";
import { requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";
import { parseInput } from "@/server/validation";
import { CONTACT_SUBJECTS } from "@/components/public/site-config";

const subjects = CONTACT_SUBJECTS.map((s) => s.label) as [string, ...string[]];

const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name.").max(120, "Name is too long."),
    email: z.union([z.literal(""), z.email("Enter a valid email address.").max(160)]).optional(),
    phone: z.union([z.literal(""), z.string().trim().max(30).regex(/^\+?[\d\s().-]{7,}$/, "Enter a valid phone number.")]).optional(),
    subject: z.enum(subjects, "Choose a subject."),
    message: z.string().trim().min(10, "Please write a little more (at least 10 characters).").max(3000, "Please keep your message under 3,000 characters."),
    hp_field: z.string().optional(), // honeypot (checked below: a filled one is dropped quietly)
  })
  .refine((v) => Boolean(v.email || v.phone), { message: "Give us an email or phone number so we can reply.", path: ["email"] });

export async function sendContactMessage(_prev: ActionResult<null> | undefined, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ipAddress } = await requestMeta();
    // Bots that fill the hidden field get a normal-looking response and nothing is stored.
    if (String(formData.get("hp_field") ?? "")) return null;
    await rateLimit(`web-contact:${ipAddress ?? "unknown"}`, 5, 600);
    const v = parseInput(contactSchema, formData);
    if (!v) throw new AppError("Please check the form.");
    await db.contactMessage.create({
      data: {
        name: v.name,
        email: v.email?.toLowerCase() || null,
        phone: v.phone || null,
        subject: v.subject,
        message: v.message,
        ipAddress,
      },
    });
    return null;
  }, "Thank you — your message has been sent. We’ll reply as soon as possible.");
}
