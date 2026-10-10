"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, isUniqueViolation, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { moveMedia, updateMedia, uploadMedia } from "@/server/services/media";
import { resetContentField, saveContentField } from "@/server/services/site-content";
import { saveTranslation } from "@/server/services/translations";
import { msg } from "@/i18n/msg";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress };
}
/** Public pages pick up website changes immediately. */
function refreshSite() {
  revalidatePath("/", "layout");
  revalidatePath("/staff/website");
}

const CATEGORIES = ["ROOMS", "BATHROOMS", "EXTERIOR", "RECEPTION", "RESTAURANT", "BAR", "BREAKFAST", "MEETING_ROOM", "FACILITIES", "EXPERIENCE", "OTHER"] as const;

/** `locale`: which language's text this is (English when left out); photos and numbers are shared. */
export async function saveContentAction(input: { path: string; value: string; locale?: string }) {
  return runAction(async () => {
    const user = await authorize("website.manage");
    await saveContentField(input.path, input.value, await actor(user), input.locale);
    refreshSite();
    return null;
  }, msg("Saved — live on the website."));
}

export async function resetContentAction(input: { path: string; locale?: string }) {
  return runAction(async () => {
    const user = await authorize("website.manage");
    await resetContentField(input.path, await actor(user), input.locale);
    refreshSite();
    return null;
  }, msg("Restored the default text."));
}

export async function uploadMediaAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("website.manage");
    const d = parseInput(z.object({
      title: z.string().trim().max(120).default(""),
      category: z.enum(CATEGORIES),
      altText: z.string().trim().min(3, msg("Describe the photo (alt text).")).max(250),
      description: z.string().trim().max(500).optional(),
      roomTypeId: z.string().optional(),
      isIllustrative: z.preprocess((v) => v === "on", z.boolean()),
      creditText: z.string().trim().max(200).optional(),
      width: z.coerce.number().int().min(1).max(20000).optional(),
      height: z.coerce.number().int().min(1).max(20000).optional(),
    }), formData);
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Choose an image.", "VALIDATION", { file: msg("Required") });
    if (d.isIllustrative && !d.creditText) throw new AppError("Credit the source of illustrative images.", "VALIDATION", { creditText: msg("Required") });
    if (d.isIllustrative && ["ROOMS", "BATHROOMS", "EXTERIOR", "RECEPTION"].includes(d.category)) {
      throw new AppError("Rooms, bathrooms, exterior and reception must be real hotel photos.", "VALIDATION", { category: msg("Real photos only") });
    }
    const media = await uploadMedia({ ...d, file, roomTypeId: d.roomTypeId || null }, await actor(user));
    if (d.width && d.height) await db.mediaAsset.update({ where: { id: media.id }, data: { width: d.width, height: d.height } });
    refreshSite();
    return null;
  }, msg("Photo added to the library."));
}

const MediaPatch = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  altText: z.string().trim().min(3).max(250).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  roomTypeId: z.string().nullable().optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function updateMediaAction(input: z.input<typeof MediaPatch>) {
  return runAction(async () => {
    const user = await authorize("website.manage");
    const { id, ...patch } = parseInput(MediaPatch, input);
    await updateMedia(id, patch, await actor(user));
    refreshSite();
    return null;
  }, msg("Photo updated."));
}

export async function moveMediaAction(input: { id: string; direction: -1 | 1 }) {
  return runAction(async () => {
    const user = await authorize("website.manage");
    await moveMedia(input.id, input.direction === -1 ? -1 : 1, await actor(user));
    refreshSite();
    return null;
  });
}

const ServiceSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, msg("Name is required.")).max(60),
  description: z.string().trim().max(300).optional(),
  category: z.enum(["DINING", "TRANSPORT", "CONVENIENCE", "BUSINESS", "OTHER"]),
  icon: z.string().trim().max(40).optional(),
  isActive: z.preprocess((v) => v === "on", z.boolean()),
  isPublic: z.preprocess((v) => v === "on", z.boolean()),
  isChargeable: z.preprocess((v) => v === "on", z.boolean()),
  price: z.union([z.literal(""), z.coerce.number().int().min(0)]).optional(),
  priceNote: z.string().trim().max(60).optional(),
});
/** The service's Chinese, saved beside it (empty = the default Chinese, else the English). */
const ServiceZh = z.object({
  zh_name: z.string().trim().max(60).optional(),
  zh_description: z.string().trim().max(300).optional(),
  zh_priceNote: z.string().trim().max(60).optional(),
});

export async function saveServiceAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("website.manage");
    const { id, ...d } = parseInput(ServiceSchema, formData);
    const zh = parseInput(ServiceZh, formData);
    let serviceId = id;
    const data = { ...d, description: d.description || null, icon: d.icon || null, price: d.price === "" || d.price === undefined ? null : d.price, priceNote: d.priceNote || null };
    try {
      if (id) {
        const before = await db.hotelService.findUniqueOrThrow({ where: { id } });
        await db.hotelService.update({ where: { id }, data });
        await audit(db, await actor(user), { action: "website.service_updated", entityType: "HotelService", entityId: id, before: { name: before.name, isActive: before.isActive, isPublic: before.isPublic, price: before.price }, after: data });
      } else {
        const code = d.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
        const count = await db.hotelService.count();
        const s = await db.hotelService.create({ data: { ...data, code, sortOrder: count } });
        serviceId = s.id;
        await audit(db, await actor(user), { action: "website.service_created", entityType: "HotelService", entityId: s.id, after: data });
      }
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("A service with this name already exists.", "CONFLICT", { name: msg("Duplicate") });
      throw e;
    }
    if (serviceId && formData.has("zh_name")) {
      await saveTranslation("hotelService", serviceId, "zh-CN", { name: zh.zh_name, description: zh.zh_description, priceNote: zh.zh_priceNote }, await actor(user));
    }
    refreshSite();
    return null;
  }, msg("Service saved."));
}
