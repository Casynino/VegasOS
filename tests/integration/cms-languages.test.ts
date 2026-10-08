import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getEditableContent, getSiteContent, resetContentField, saveContentField } from "@/server/services/site-content";
import { saveTranslation } from "@/server/services/translations";
import { CONTENT_ZH } from "@/components/public/content.zh-CN";
import { DEFAULT_CONTENT } from "@/components/public/content";
import { managerActor } from "../support/helpers";

describe("website CMS in two languages", () => {
  afterAll(async () => {
    await db.siteContent.deleteMany();
    await db.hotelServiceTranslation.deleteMany();
  });

  it("Chinese visitors get the Chinese default, staff's Chinese, or the English edit — never a stale translation", async () => {
    const mgr = await managerActor();
    const actor = { ...mgr, userId: mgr.userId! };
    const zhDefault = CONTENT_ZH.pages!.footer!.blurb!;

    expect((await getSiteContent("zh-CN")).pages.footer.blurb).toBe(zhDefault);
    expect((await getSiteContent("en")).pages.footer.blurb).toBe(DEFAULT_CONTENT.pages.footer.blurb);

    // English changed by staff, no Chinese yet → Chinese visitors see the new English.
    await saveContentField("pages.footer.blurb", "Karibu — now with a rooftop view.", actor);
    expect((await getSiteContent("zh-CN")).pages.footer.blurb).toBe("Karibu — now with a rooftop view.");

    // Chinese saved → it wins for Chinese visitors only; audited with the language.
    await saveContentField("pages.footer.blurb", "欢迎光临。", actor, "zh-CN");
    expect((await getSiteContent("zh-CN")).pages.footer.blurb).toBe("欢迎光临。");
    expect((await getSiteContent("en")).pages.footer.blurb).toBe("Karibu — now with a rooftop view.");
    const log = await db.auditLog.findFirst({ where: { entityId: "zh-CN:pages.footer.blurb" }, orderBy: { createdAt: "desc" } });
    expect(log?.after).toEqual({ language: "zh-CN", value: "欢迎光临。" });

    const field = (await getEditableContent()).flatMap((s) => s.fields).find((f) => f.path === "pages.footer.blurb")!;
    expect(field.value).toBe("Karibu — now with a rooftop view.");
    expect(field.zh?.value).toBe("欢迎光临。");

    // Lists in Chinese, and resets per language.
    await saveContentField("pages.restaurant.cuisines", "非洲菜\n烧烤", actor, "zh-CN");
    expect((await getSiteContent("zh-CN")).pages.restaurant.cuisines).toEqual(["非洲菜", "烧烤"]);
    await resetContentField("pages.footer.blurb", actor, "zh-CN");
    expect((await getSiteContent("zh-CN")).pages.footer.blurb).toBe("Karibu — now with a rooftop view.");
    await resetContentField("pages.footer.blurb", actor);
    expect((await getSiteContent("zh-CN")).pages.footer.blurb).toBe(zhDefault);
  });

  it("photos and numbers are shared; only their alt text is translated", async () => {
    const mgr = await managerActor();
    const actor = { ...mgr, userId: mgr.userId! };
    await expect(saveContentField("facts.airportKm", "20", actor, "zh-CN")).rejects.toThrow(/same in every language/);
    await expect(saveContentField("home.hero.image", "x", actor, "zh-CN")).rejects.toThrow(/same in every language/);
    await expect(saveContentField("pages.footer.blurb", "x", actor, "fr")).rejects.toThrow(/Choose a language/);
    const zh = await getSiteContent("zh-CN");
    expect(zh.home.hero.image.src).toBe(DEFAULT_CONTENT.home.hero.image.src);
    expect(zh.home.hero.image.alt).not.toBe(DEFAULT_CONTENT.home.hero.image.alt);
  });

  it("services show their saved Chinese, else the default Chinese, else the English", async () => {
    const mgr = await managerActor();
    const actor = { ...mgr, userId: mgr.userId! };
    const svc = await db.hotelService.findFirstOrThrow({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } });
    await saveTranslation("hotelService", svc.id, "zh-CN", { name: "测试服务", description: "测试描述" }, actor);
    const zh = await getSiteContent("zh-CN");
    expect(zh.services.find((s) => s.key === svc.code)?.name).toBe("测试服务");
    const en = await getSiteContent("en");
    expect(en.services.find((s) => s.key === svc.code)?.name).toBe(svc.name);
    await saveTranslation("hotelService", svc.id, "zh-CN", { name: "", description: "" }, actor);
    expect(await db.hotelServiceTranslation.count({ where: { parentId: svc.id } })).toBe(0);
  });
});
