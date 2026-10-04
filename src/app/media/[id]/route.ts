import { db } from "@/server/db";

/**
 * Public delivery of uploaded website media (active library items only).
 * Each upload gets a new id, so responses are immutable and CDN-cacheable.
 */
export async function GET(_req: Request, ctx: RouteContext<"/media/[id]">) {
  const { id } = await ctx.params;
  const media = await db.mediaAsset.findUnique({ where: { id }, include: { file: true } });
  if (!media || !media.isActive || !media.file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(media.file.data), {
    headers: {
      "Content-Type": media.file.contentType,
      "Content-Length": String(media.file.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
