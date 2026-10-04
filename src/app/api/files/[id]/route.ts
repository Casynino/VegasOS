import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";

/** Who may see a stored file: expense receipts for finance; a customer's payment screenshot for the restaurant and finance. */
const CAN_SEE: Record<string, string[]> = {
  PAYMENT_PROOF: ["restaurant.orders", "restaurant.serve", "revenue.record", "restaurant.payments.confirm", "finance.view"],
  /** A supplier's receipt for a stock purchase: whoever buys and whoever approves — never the staff who only ask. */
  PURCHASE_RECEIPT: ["inventory.receive", "expenses.approve"],
};

/** Serve an uploaded file to authorised staff only (never public, never cached by shared caches). `?download=1` saves it. */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const file = await db.storedFile.findUnique({ where: { id } });
  if (!file) return new Response("Not found", { status: 404 });
  const allowed = file.uploadedById === user.id || user.permissions.has("expenses.view_all") || user.permissions.has("finance.view")
    || (CAN_SEE[file.purpose] ?? []).some((p) => user.permissions.has(p as never));
  if (!allowed) return new Response("Forbidden", { status: 403 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
