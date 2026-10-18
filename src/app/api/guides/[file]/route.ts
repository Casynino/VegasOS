import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { GUIDE_FILE, guideBooksFor } from "@/lib/guide-books";
import { guideBlobFor } from "@/server/services/guide-books";

/**
 * A guide book, to the person it is for only (owner, 2026-10-19: everybody gets their own department's book on their dashboard).
 * Signed in; the book must be one of THEIR books (`guideBooksFor`: the Boss, the MD, the Manager and the Developer have all twelve);
 * then they are sent to the file in the hotel's file storage — saved as a file by default, shown in the browser to read or print with `?open=1`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/guides/[file]">): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { file } = await ctx.params;
  if (!GUIDE_FILE.test(file)) return new Response("Not found", { status: 404 });
  // Their own books; the people who have every book also have a book added later under the same name rule ("Other books" on the page).
  const access = guideBooksFor(user.permissions);
  if (!access.all && !access.files.includes(file)) return new Response("Forbidden", { status: 403 });
  const book = await guideBlobFor(file);
  if (!book) return new Response("This guide book has not been put here yet.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const open = new URL(request.url).searchParams.get("open") === "1";
  return NextResponse.redirect(open ? book.url : book.downloadUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
