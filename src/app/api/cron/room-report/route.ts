import { timingSafeEqual } from "node:crypto";
import { runRoomReportJob } from "@/server/services/room-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * Vercel Cron (see vercel.json): runs at 6:30 AM Tanzania time (03:30 UTC) every day.
 * Sends the Boss a compact room report covering yesterday's check-ins, occupancy,
 * and room revenue — with new check-ins vs continuing stays highlighted.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const t0 = Date.now();
  try {
    const until = t0 + 44_000;
    const result = await runRoomReportJob(new Date(), until);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron] room report failed", e);
    return Response.json({ ok: false, error: "Room report job failed" }, { status: 500 });
  }
}
