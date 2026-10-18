import "server-only";
import { unstable_cache } from "next/cache";
import { del, list } from "@vercel/blob";
import { GUIDE_FILE, GUIDE_FOLDER } from "@/lib/guide-books";

/**
 * The guide books kept in the hotel's file storage (Vercel Blob). Read-only listing for everyone who may see the page; removing is for the
 * Developer's action only (checked there). Without a storage token (a computer used for building) there is nothing to list: the page says so.
 */
export interface StoredGuide { file: string; size: number; uploadedAt: Date; url: string; downloadUrl: string }

export const guideStorageReady = (): boolean => !!process.env.BLOB_READ_WRITE_TOKEN;

export async function storedGuides(): Promise<StoredGuide[] | null> {
  if (!guideStorageReady()) return null;
  try {
    const out: StoredGuide[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await list({ prefix: GUIDE_FOLDER, limit: 100, cursor });
      for (const b of res.blobs) {
        const file = b.pathname.slice(GUIDE_FOLDER.length);
        if (GUIDE_FILE.test(file)) out.push({ file, size: b.size, uploadedAt: b.uploadedAt, url: b.url, downloadUrl: b.downloadUrl });
      }
      if (!res.hasMore) break;
      cursor = res.cursor;
    }
    return out.sort((a, b) => a.file.localeCompare(b.file));
  } catch (error) {
    console.error("[guide-books] the file storage could not be read", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

export async function removeStoredGuide(file: string): Promise<boolean> {
  if (!guideStorageReady() || !GUIDE_FILE.test(file)) return false;
  const all = await storedGuides();
  const found = all?.find((g) => g.file === file);
  if (!found) return false;
  await del(found.url);
  return true;
}

/** One book's address in the file storage (null = not there). Read when somebody presses Download or Open, so it is never stale. */
export async function guideBlobFor(file: string): Promise<{ url: string; downloadUrl: string } | null> {
  if (!guideStorageReady() || !GUIDE_FILE.test(file)) return null;
  try {
    const res = await list({ prefix: `${GUIDE_FOLDER}${file}`, limit: 5 });
    const b = res.blobs.find((x) => x.pathname === `${GUIDE_FOLDER}${file}`);
    return b ? { url: b.url, downloadUrl: b.downloadUrl } : null;
  } catch (error) {
    console.error("[guide-books] a book could not be found in the file storage", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

/** Which books are in the storage (just the names), kept for a minute: every dashboard asks, so it must not call the storage each time. null = unknown / no storage. */
export const uploadedGuideFiles = unstable_cache(async (): Promise<string[] | null> => (await storedGuides())?.map((g) => g.file) ?? null, ["guide-books-files"], { revalidate: 60 });
