import "server-only";
import { del, put } from "@vercel/blob";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import type { MediaCategory } from "@/generated/prisma/enums";
import type { MediaAsset } from "@/generated/prisma/client";

/**
 * Media library (website CMS). The library is the single source of truth for
 * website imagery; each room type's `images` list is a derived cache kept in
 * sync here so public pages never hard-code image URLs.
 */

export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function mediaUrl(m: Pick<MediaAsset, "id" | "url">): string {
  return m.url ?? `/media/${m.id}`;
}

/** Recompute a room type's ordered image list from its active media. */
export async function syncRoomTypeImages(tx: Tx | typeof db, roomTypeId: string) {
  const media = await tx.mediaAsset.findMany({ where: { roomTypeId, isActive: true }, orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }] });
  await tx.roomType.update({ where: { id: roomTypeId }, data: { images: media.map(mediaUrl) } });
}

export async function uploadMedia(
  input: { file: File; title: string; category: MediaCategory; altText: string; description?: string | null; roomTypeId?: string | null; isIllustrative?: boolean; creditText?: string | null },
  actor: AuditActor & { userId: string },
) {
  const { file } = input;
  if (!file || file.size === 0) throw new AppError("Choose an image.", "VALIDATION", { file: "Required" });
  if (file.size > MEDIA_MAX_BYTES) throw new AppError("Image is larger than 8 MB — export a smaller version.", "VALIDATION", { file: "Too large" });
  if (!MEDIA_TYPES.includes(file.type)) throw new AppError("Use a JPG, PNG, WebP or AVIF image.", "VALIDATION", { file: "Wrong type" });
  if (!input.altText.trim()) throw new AppError("Describe the image for screen readers (alt text).", "VALIDATION", { altText: "Required" });
  // On the live site the photo goes to Vercel Blob (fast, and the database keeps only its link); without Blob
  // (this computer) it is stored in the database as before.
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(-80) || "photo";
  const blob = process.env.BLOB_READ_WRITE_TOKEN
    ? await put(`media/${input.category.toLowerCase()}/${safeName}`, file, { access: "public", contentType: file.type, addRandomSuffix: true })
    : null;
  try {
    return await saveMedia(input, file, blob?.url ?? null, actor);
  } catch (e) {
    if (blob) await del(blob.url).catch(() => {}); // nothing left behind when saving failed
    throw e;
  }
}

async function saveMedia(
  input: Parameters<typeof uploadMedia>[0], file: File, blobUrl: string | null, actor: AuditActor & { userId: string },
) {
  return db.$transaction(async (tx) => {
    const stored = blobUrl ? null : await tx.storedFile.create({
      data: { purpose: "MEDIA", fileName: file.name.slice(0, 120), contentType: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()), uploadedById: actor.userId },
    });
    const last = await tx.mediaAsset.aggregate({ where: { category: input.category }, _max: { sortOrder: true } });
    const media = await tx.mediaAsset.create({
      data: {
        title: input.title.trim() || file.name, category: input.category, altText: input.altText.trim(), description: input.description?.trim() || null,
        url: blobUrl, fileId: stored?.id ?? null, roomTypeId: input.roomTypeId || null, sortOrder: (last._max.sortOrder ?? 0) + 1,
        isIllustrative: !!input.isIllustrative, creditText: input.creditText?.trim() || null, createdById: actor.userId,
      },
    });
    if (media.roomTypeId) await syncRoomTypeImages(tx, media.roomTypeId);
    await audit(tx, actor, { action: "media.uploaded", entityType: "MediaAsset", entityId: media.id, after: { title: media.title, category: media.category, roomTypeId: media.roomTypeId } });
    return media;
  });
}

export async function updateMedia(
  id: string,
  patch: Partial<{ title: string; category: MediaCategory; altText: string; description: string | null; roomTypeId: string | null; sortOrder: number; isFeatured: boolean; isActive: boolean; isIllustrative: boolean; creditText: string | null }>,
  actor: AuditActor,
) {
  if (patch.altText !== undefined && !patch.altText.trim()) throw new AppError("Alt text cannot be empty.");
  return db.$transaction(async (tx) => {
    const before = await tx.mediaAsset.findUnique({ where: { id } });
    if (!before) throw new AppError("Image not found.", "NOT_FOUND");
    const after = await tx.mediaAsset.update({ where: { id }, data: patch });
    for (const rt of new Set([before.roomTypeId, after.roomTypeId].filter(Boolean) as string[])) await syncRoomTypeImages(tx, rt);
    await audit(tx, actor, { action: "media.updated", entityType: "MediaAsset", entityId: id, before: pick(before, Object.keys(patch)), after: patch });
    return after;
  });
}

/** Move an image up/down within its room type (or category when unassigned). */
export async function moveMedia(id: string, direction: -1 | 1, actor: AuditActor) {
  return db.$transaction(async (tx) => {
    const m = await tx.mediaAsset.findUnique({ where: { id } });
    if (!m) throw new AppError("Image not found.", "NOT_FOUND");
    const siblings = await tx.mediaAsset.findMany({
      where: m.roomTypeId ? { roomTypeId: m.roomTypeId } : { category: m.category, roomTypeId: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const i = siblings.findIndex((s) => s.id === id);
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    for (const [k, s] of siblings.entries()) if (s.sortOrder !== k) await tx.mediaAsset.update({ where: { id: s.id }, data: { sortOrder: k } });
    if (m.roomTypeId) await syncRoomTypeImages(tx, m.roomTypeId);
    await audit(tx, actor, { action: "media.reordered", entityType: "MediaAsset", entityId: id, after: { direction } });
  });
}

function pick<T extends object>(o: T, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]]));
}

/** Public gallery / section imagery. Illustrative images are excluded from the hotel gallery by default. */
export async function publicMedia(opts: { categories?: MediaCategory[]; includeIllustrative?: boolean; featuredOnly?: boolean; take?: number } = {}) {
  const rows = await db.mediaAsset.findMany({
    where: {
      isActive: true,
      ...(opts.categories && { category: { in: opts.categories } }),
      ...(!opts.includeIllustrative && { isIllustrative: false }),
      ...(opts.featuredOnly && { isFeatured: true }),
    },
    orderBy: [{ isFeatured: "desc" }, { category: "asc" }, { sortOrder: "asc" }],
    take: opts.take,
  });
  return rows.map((m) => ({ id: m.id, src: mediaUrl(m), alt: m.altText, title: m.title, category: m.category, description: m.description, isIllustrative: m.isIllustrative, credit: m.creditText }));
}
