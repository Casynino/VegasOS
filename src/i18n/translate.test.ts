import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { makeT } from "./translate";
import { localeFromSegment, toLocale } from "./config";
import { msgf } from "./msg";
import { orderItemName, snapshotName } from "./content";

const zh = { "Check in": "办理入住", "Room {room} is ready": "{room} 号房已准备好", "{n} nights": "{n} 晚", "Only <b>Paid</b> is money in": "只有<b>已付款</b>才算收入" };

describe("translations", () => {
  it("English is its own key; Chinese falls back to English, never a key or blank", () => {
    const en = makeT("en", null);
    expect(en("Check in")).toBe("Check in");
    const t = makeT("zh-CN", zh);
    expect(t("Check in")).toBe("办理入住");
    expect(t("Not translated yet")).toBe("Not translated yet");
    expect(t("")).toBe("");
  });

  it("fills values the same way in every language and keeps unknown placeholders", () => {
    const t = makeT("zh-CN", zh);
    expect(t("Room {room} is ready", { room: "204" })).toBe("204 号房已准备好");
    expect(makeT("en", null)("Room {room} is ready", { room: 204 })).toBe("Room 204 is ready");
    expect(t("Hello {name}", {})).toBe("Hello {name}");
  });

  it("plurals: English picks the form, Chinese has one", () => {
    const en = makeT("en", null);
    expect(en.plural(1, "{n} night", "{n} nights")).toBe("1 night");
    expect(en.plural(3, "{n} night", "{n} nights")).toBe("3 nights");
    expect(makeT("zh-CN", zh).plural(1, "{n} night", "{n} nights")).toBe("1 晚");
  });

  it("rich text keeps its tags in either language", () => {
    const out = makeT("zh-CN", zh).rich("Only <b>Paid</b> is money in", { b: (c) => `[${c}]` });
    expect(isValidElement(out)).toBe(true);
  });

  it("dates keep the hotel's day and change only the wording", () => {
    expect(makeT("en", null).date("2026-10-12")).toBe("Mon, 12 Oct 2026");
    const zhDate = makeT("zh-CN", zh).date("2026-10-12");
    expect(zhDate).toContain("2026");
    expect(zhDate).toContain("10");
    expect(zhDate).toContain("12");
    expect(makeT("en", null).time(new Date("2026-10-12T11:05:00Z"))).toBe("14:05");
    expect(makeT("zh-CN", zh).time(new Date("2026-10-12T11:05:00Z"))).toBe("14:05");
  });

  it("a word with two meanings picks its context, English stays the word", () => {
    const t = makeT("zh-CN", { Available: "空闲", "menu::Available": "有货" });
    expect(t("Available")).toBe("空闲");
    expect(t.ctx("menu", "Available")).toBe("有货");
    expect(t.ctx("room", "Available")).toBe("空闲");
    expect(makeT("en", null).ctx("menu", "Available")).toBe("Available");
  });

  it("reads what people and links say", () => {
    expect(toLocale("zh")).toBe("zh-CN");
    expect(toLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(toLocale("EN-us")).toBe("en");
    expect(toLocale("fr")).toBeNull();
    expect(localeFromSegment("zh")).toBe("zh-CN");
    expect(localeFromSegment("xx")).toBeNull();
  });

  it("msgf keeps the English for logs and the key + values for the reader", () => {
    const m = msgf("Room {room} is ready", { room: "204" });
    expect(String(m)).toBe("Room 204 is ready");
    expect(makeT("zh-CN", zh)(m.key, m.vars)).toBe("204 号房已准备好");
  });

  it("an order line keeps the name it had when ordered", () => {
    const t = makeT("zh-CN", { "Beef Burger": "新名字" });
    expect(snapshotName("Beef Burger", { "zh-CN": "牛肉汉堡" }, "zh-CN")).toBe("牛肉汉堡");
    expect(orderItemName({ name: "Beef Burger", nameI18n: { "zh-CN": "牛肉汉堡" } }, t)).toBe("牛肉汉堡");
    expect(orderItemName({ name: "Beef Burger", nameI18n: null }, t)).toBe("新名字");
    expect(orderItemName({ name: "Beef Burger", nameI18n: { "zh-CN": "牛肉汉堡" } }, makeT("en", null))).toBe("Beef Burger");
  });
});
