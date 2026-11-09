import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INSTALL_WORDS } from "./install-words";

/**
 * The sign-in page ships only a short list of words to the browser (see login/page.tsx). Every word the "Use it like an app" card shows
 * must be in INSTALL_WORDS, or a Chinese phone would see English there. This reads the card's source and checks it.
 */
describe("the full-screen app card's words", () => {
  const source = readFileSync(new URL("./install-app.tsx", import.meta.url), "utf8");
  const used = [...source.matchAll(/\bt(?:\.rich)?\(\s*"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1].replace(/\\"/g, '"').replace(/\\'/g, "'"));

  it("finds the words it uses", () => {
    expect(used.length).toBeGreaterThan(15);
  });
  it("lists every one of them in INSTALL_WORDS", () => {
    const listed = new Set<string>(INSTALL_WORDS);
    expect(used.filter((w) => !listed.has(w))).toEqual([]);
  });
  it("lists nothing the card never shows", () => {
    const text = source;
    const extra = INSTALL_WORDS.filter((w) => w !== "Get the app" && w !== "Get the full-screen app" && !text.includes(w.replace(/'/g, "\\'")) && !text.includes(w));
    expect(extra).toEqual([]);
  });
});
