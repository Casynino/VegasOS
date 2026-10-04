import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getSiteContent, resetContentField, saveContentField } from "@/server/services/site-content";
import { updateMedia } from "@/server/services/media";
import { managerActor } from "../support/helpers";

describe("website CMS", () => {
  afterAll(async () => { await db.siteContent.deleteMany(); });

  it("edits override defaults, reset restores them, unknown paths are refused", async () => {
    const mgr = await managerActor();
    const actor = { ...mgr, userId: mgr.userId! };
    const before = await getSiteContent();
    await saveContentField("pages.footer.blurb", "Karibu sana — book direct.", actor);
    expect((await getSiteContent()).pages.footer.blurb).toBe("Karibu sana — book direct.");
    await saveContentField("pages.restaurant.cuisines", "African\nGrill", actor);
    expect((await getSiteContent()).pages.restaurant.cuisines).toEqual(["African", "Grill"]);
    await expect(saveContentField("home.hero.primaryCta.href", "https://evil.example", actor)).rejects.toThrow(/cannot be edited/);
    await resetContentField("pages.footer.blurb", actor);
    expect((await getSiteContent()).pages.footer.blurb).toBe(before.pages.footer.blurb);
  });

  it("services come from the database; illustrative images never reach hotel photo slots", async () => {
    const mgr = await managerActor();
    const actor = { ...mgr, userId: mgr.userId! };
    const c = await getSiteContent();
    expect(c.services.map((s) => s.key)).toContain("AIRPORT_TRANSFER");
    const media = await db.mediaAsset.create({ data: { title: "Dish", category: "RESTAURANT", altText: "A plated dish", url: "/images/stock/x.webp", isIllustrative: true } });
    await expect(saveContentField("home.hero.image", media.id, actor)).rejects.toThrow(/Illustrative/);
    expect((await getSiteContent()).gallery.some((g) => g.src === "/images/stock/x.webp")).toBe(false);
    await updateMedia(media.id, { isActive: false }, actor);
  });
});
