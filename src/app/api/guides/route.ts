import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getT } from "@/i18n/server";
import { GUIDE_CATALOG, guideBooksFor } from "@/lib/guide-books";
import { guideStorageReady, storedGuides } from "@/server/services/guide-books";

/**
 * The person's own guide book(s) for the pop-up behind the small "Guide book" button (owner, 2026-10-19): titles in their own language, and which
 * of them are in the file storage yet. Asked only when the pop-up opens, so no page waits for the storage. `listed: false` = the storage could not
 * be read (the pop-up then still offers the buttons; the download says if a book is missing).
 */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const access = guideBooksFor(user.permissions);
  const t = await getT();
  const stored = guideStorageReady() ? await storedGuides() : null;
  const byFile = new Map((stored ?? []).map((g) => [g.file, g]));
  const books = GUIDE_CATALOG.filter((b) => access.files.includes(b.file)).map((b) => ({
    file: b.file, number: b.number, title: t(b.title), audience: b.audience ? t(b.audience) : "",
    size: byFile.get(b.file)?.size ?? null, uploaded: byFile.has(b.file),
  }));
  return NextResponse.json({ all: access.all, listed: stored !== null, books }, { headers: { "Cache-Control": "no-store" } });
}
