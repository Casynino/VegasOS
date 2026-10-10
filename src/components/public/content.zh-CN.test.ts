import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT, GALLERY, ILLUSTRATIVE } from "./content";
import { ALT_ZH, CONTENT_ZH, overlay } from "./content.zh-CN";
import CONTENT_DB_ZH from "@/i18n/content/zh-CN";

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** Every string in the Chinese overlay, with its path. */
function strings(node: unknown, path: string[] = [], out: [string[], string][] = []) {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, [...path, String(i)], out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, [...path, k], out);
  return out;
}
const at = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

describe("website copy in Chinese", () => {
  it("only translates fields the English has, with the same placeholders", () => {
    for (const [path, zh] of strings(CONTENT_ZH)) {
      const en = at(DEFAULT_CONTENT, path);
      expect(typeof en, path.join(".")).toBe("string");
      expect(holes(zh), path.join(".")).toBe(holes(en as string));
      expect(zh.trim(), path.join(".")).not.toBe("");
    }
  });

  it("keeps lists of items the same length as the English (images and links stay shared)", () => {
    const zh = overlay(structuredClone(DEFAULT_CONTENT), CONTENT_ZH) as typeof DEFAULT_CONTENT;
    expect(zh.home.hero.slides.map((s) => s.src)).toEqual(DEFAULT_CONTENT.home.hero.slides.map((s) => s.src));
    expect(zh.home.stay.items.map((s) => s.href)).toEqual(DEFAULT_CONTENT.home.stay.items.map((s) => s.href));
    expect(zh.home.hero.primaryCta.href).toBe("/book");
    expect(zh.home.hero.title).toBe("您的旅居，");
    expect(zh.facts.airportKm).toBe(DEFAULT_CONTENT.facts.airportKm);
    expect(zh.pages.restaurant.cuisines.length).toBe(DEFAULT_CONTENT.pages.restaurant.cuisines.length);
    expect(zh.services.map((s) => s.icon)).toEqual(DEFAULT_CONTENT.services.map((s) => s.icon));
  });

  it("never changes the English defaults", () => {
    const before = JSON.stringify(DEFAULT_CONTENT);
    overlay(DEFAULT_CONTENT, CONTENT_ZH);
    expect(JSON.stringify(DEFAULT_CONTENT)).toBe(before);
  });

  it("has a Chinese alt text for every photo the site describes", () => {
    const alts = new Set<string>();
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        const o = n as Record<string, unknown>;
        if (typeof o.alt === "string" && o.alt) alts.add(o.alt);
        Object.values(o).forEach(walk);
      }
    };
    walk(DEFAULT_CONTENT); walk(GALLERY); walk(ILLUSTRATIVE);
    expect([...alts].filter((a) => !ALT_ZH[a])).toEqual([]);
  });
});

describe("the hotel's content in Chinese (default translations)", () => {
  it("keeps placeholders and is never empty", () => {
    for (const [en, zh] of Object.entries(CONTENT_DB_ZH)) {
      expect(zh.trim(), en).not.toBe("");
      expect(holes(zh), en).toBe(holes(en));
    }
  });
});
