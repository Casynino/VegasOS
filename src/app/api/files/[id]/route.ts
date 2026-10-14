import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { guardDeveloperExport } from "@/server/services/developer-view-log";

/** Who may see a stored file: expense receipts for finance; a customer's payment screenshot for the restaurant and finance. */
const CAN_SEE: Record<string, string[]> = {
  PAYMENT_PROOF: ["restaurant.orders", "restaurant.serve", "revenue.record", "restaurant.payments.confirm", "finance.view"],
  /** A supplier's receipt for a stock purchase: whoever buys and whoever approves — never the staff who only ask. */
  PURCHASE_RECEIPT: ["inventory.receive", "expenses.approve"],
  /** A document kept with a purchase request (photo, quotation, delivery note, supplier invoice): the person who uploaded it, Finance, the buyers and whoever reviews. */
  STOCK_DOCUMENT: ["procurement.manage", "expenses.approve", "purchases.authorize", "purchases.pay", "inventory.receive"],
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
  const url = new URL(req.url);
  const download = url.searchParams.get("download") === "1";
  // A Developer's look at a file (shown or saved) is written to the audit trail BEFORE the file is sent — and it is not sent when that cannot be written.
  const blocked = await guardDeveloperExport(user, {
    kind: "downloaded", module: "StoredFile", entityId: file.id,
    after: { path: url.pathname, purpose: file.purpose, fileName: file.fileName, contentType: file.contentType, size: file.size, download },
  });
  if (blocked) return blocked;
  return new Response(Buffer.from(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/[^\w.\- ]/g, "_")}"`,
      // A Developer's copy is never kept by the browser: every look comes back here and is written down.
      "Cache-Control": user.actorType === "DEVELOPER" ? "private, no-store" : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
