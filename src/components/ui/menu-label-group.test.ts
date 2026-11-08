import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Base UI throws (error 31, "MenuGroupContext is missing") the moment a menu opens when a menu label is not inside a group — and the whole page
 * turns into "This page couldn't load". It only happens when the menu is opened, so no page load shows it. Every file that draws a menu label
 * (DropdownMenuLabel) or a select label (SelectLabel) must also draw the group it belongs to.
 */
const SRC = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" || name === "node_modules" ? [] : files(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

const PAIRS = [
  { label: "<DropdownMenuLabel", group: "<DropdownMenuGroup" },
  { label: "<SelectLabel", group: "<SelectGroup" },
];

describe("menu labels sit inside their group", () => {
  const all = files(SRC).filter((f) => !/\/components\/ui\/(dropdown-menu|select)\.tsx$/.test(f));

  it("finds the files it checks", () => {
    expect(all.length).toBeGreaterThan(100);
  });

  for (const { label, group } of PAIRS) {
    it(`every file with ${label.slice(1)} also has ${group.slice(1)}`, () => {
      const missing = all
        .filter((f) => {
          const text = readFileSync(f, "utf8");
          return text.includes(label) && !text.includes(group);
        })
        .map((f) => path.relative(SRC, f));
      expect(missing).toEqual([]);
    });
  }
});
