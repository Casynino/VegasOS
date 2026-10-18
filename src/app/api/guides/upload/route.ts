import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/server/auth";
import { GUIDE_FILE, GUIDE_FOLDER, GUIDE_MAX_BYTES } from "@/lib/guide-books";

/**
 * The browser asks here for permission to put a guide book (a PDF of up to 60 MB, too big for a server action) into the file storage.
 * Only the Developer, signed in as himself (not while working as someone), is given a token, and only for a PDF named like the books
 * (Vegas-Guide-07-Manager.pdf) under guide-books/. The same name replaces the old book (the file may be cached for one minute only, so a new
 * edition is what people get next). Nothing else can be uploaded through here.
 */
export async function POST(request: Request): Promise<Response> {
  let body: HandleUploadBody;
  try { body = (await request.json()) as HandleUploadBody; } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof body.type !== "string") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  // The storage's own "upload finished" call carries no sign-in cookie (handleUpload checks its signature, and our handler for it does nothing).
  if (body.type !== "blob.upload-completed") {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.workAs || user.actorType !== "DEVELOPER" || !user.permissions.has("developer.access")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await handleUpload({
      body, request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(GUIDE_FOLDER) || !GUIDE_FILE.test(pathname.slice(GUIDE_FOLDER.length))) throw new Error("Not a guide book file name");
        return { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: GUIDE_MAX_BYTES, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
      },
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "The upload was refused" }, { status: 400 });
  }
}
