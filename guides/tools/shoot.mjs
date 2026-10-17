// Takes the pictures for the guide books from the guide's own PRACTICE copy on this computer (see local.mjs) — never the live hotel.
//
//   node guides/tools/shoot.mjs            every picture in guides/tools/shots.mjs
//   node guides/tools/shoot.mjs rec- wtr-  only pictures whose name starts with one of these
//
// It signs in as a practice account by giving the local database a short sign-in of its own (removed again at the end),
// so no password is typed or kept anywhere. It refuses to run against anything but a database on this computer.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch, sleep } from "./chrome.mjs";
import { GUIDE_BASE as BASE, guideDbUrl } from "./local.mjs";

// --list=survey takes the pictures listed in guides/tools/survey.mjs instead of shots.mjs
const LIST = process.argv.find((a) => a.startsWith("--list="))?.split("=")[1] ?? "shots";
const { SHOTS } = await import(`./${LIST}.mjs`);

const ROOT = process.cwd();
const OUT = path.join(ROOT, "guides", "shots");
const require = createRequire(ROOT + "/");
const pg = require("pg");

let dbUrl;
try { dbUrl = guideDbUrl(ROOT); } catch (e) { console.error("Stopped: " + e.message); process.exit(1); }

const VIEW = {
  desk: { width: 1180, height: 760, deviceScaleFactor: 1.5, mobile: false },
  wide: { width: 1440, height: 900, deviceScaleFactor: 1.25, mobile: false },
  tablet: { width: 1024, height: 768, deviceScaleFactor: 1.5, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// Runs inside the page: finding things by the words on them, and drawing the numbered marks.
const HELPERS = `(() => {
  if (window.__g) return;
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return r.width > 2 && r.height > 2 && c.visibility !== "hidden" && c.display !== "none" && +c.opacity > 0.05; };
  const find = (target) => {
    if (target.startsWith("css:")) { const [sel, nth] = target.slice(4).split("##"); return [...document.querySelectorAll(sel)].filter(visible)[+(nth || 1) - 1] || null; }
    const [text, nth] = target.split("##");
    const want = norm(text).toLowerCase();
    const all = [...document.querySelectorAll("button,a,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],label,summary,h1,h2,h3,h4,th,td,dt,span,p,li,div,input,textarea,select")].filter(visible);
    const words = (el) => norm(el.matches("input,textarea") ? (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "") : (el.getAttribute("aria-label") && !norm(el.innerText) ? el.getAttribute("aria-label") : el.innerText)).toLowerCase();
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const press = (el) => (el.matches("button,a,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],summary,input,textarea,select") ? 0 : 1);
    for (const test of [(w) => w === want, (w) => w.startsWith(want), (w) => w.includes(want)]) {
      const hits = all.filter((el) => test(words(el))).sort((a, b) => press(a) - press(b) || area(a) - area(b));
      // the same words on a parent and its child are one thing: keep the innermost
      const uniq = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o) && press(o) <= press(el)));
      const list = (uniq.length ? uniq : hits).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      if (list.length) return list[+(nth || 1) - 1] || null;
    }
    return null;
  };
  const rect = (target, scroll) => {
    const el = find(target);
    if (!el) return null;
    if (scroll) el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, px: r.left + scrollX, py: r.top + scrollY };
  };
  const mark = (n, target, o = {}) => {
    let el = find(target);
    if (!el) return false;
    // words on a button: the mark goes round the whole button, not over its first letter ("up" climbs further, to a card or a tile)
    if (!o.self) el = el.closest("button,a,[role=button],[role=tab],[role=switch],summary") || el;
    for (let i = 0; i < (o.up || 0) && el.parentElement; i++) el = el.parentElement;
    const r = el.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.setAttribute("data-guide-mark", "");
    const size = o.size || 26;
    const at = o.at || "tl";
    let x = r.left - size * 0.55, y = r.top - size * 0.55;
    if (at === "tr") x = r.right - size * 0.45;
    if (at === "l") { x = r.left - size - 6; y = r.top + r.height / 2 - size / 2; }
    if (at === "r") { x = r.right + 6; y = r.top + r.height / 2 - size / 2; }
    if (at === "t") { x = r.left + r.width / 2 - size / 2; y = r.top - size - 4; }
    if (at === "b") { x = r.left + r.width / 2 - size / 2; y = r.bottom + 4; }
    if (at === "in") { x = r.left + 6; y = r.top + 6; }
    x = Math.max(4, Math.min(innerWidth - size - 4, x + (o.dx || 0))); y = Math.max(4, y + (o.dy || 0));
    if (o.ring !== false) {
      const ring = document.createElement("div");
      const pad = o.pad ?? 4;
      ring.style.cssText = "position:absolute;z-index:2147483646;pointer-events:none;border:2.5px solid #c8962e;border-radius:10px;box-shadow:0 0 0 3px rgba(200,150,46,.22);left:" + (r.left + scrollX - pad) + "px;top:" + (r.top + scrollY - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
      ring.setAttribute("data-guide-mark", "");
      document.body.appendChild(ring);
    }
    layer.textContent = n;
    layer.style.cssText = "position:absolute;z-index:2147483647;pointer-events:none;display:grid;place-items:center;font:700 " + Math.round(size * 0.54) + "px/1 -apple-system,Inter,Arial,sans-serif;color:#17130a;background:#e2b24a;border:2px solid #fff;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.35);width:" + size + "px;height:" + size + "px;left:" + (x + scrollX) + "px;top:" + (y + scrollY) + "px";
    document.body.appendChild(layer);
    return true;
  };
  const tidy = () => {
    if (document.getElementById("guide-tidy")) return;
    const s = document.createElement("style");
    s.id = "guide-tidy";
    s.textContent = "nextjs-portal,[data-nextjs-toast],#__next-build-watcher,[data-next-badge-root]{display:none!important}*{caret-color:transparent!important}";
    document.head.appendChild(s);
  };
  const grow = () => { // how much taller the window must be to show a whole page that scrolls inside itself
    let extra = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    for (const el of document.querySelectorAll("main,div,section")) {
      const c = getComputedStyle(el);
      if ((c.overflowY === "auto" || c.overflowY === "scroll") && el.clientHeight > innerHeight * 0.5) extra = Math.max(extra, el.scrollHeight - el.clientHeight);
    }
    return extra;
  };
  // where a thing sits in the page — the same place holds the same thing in the other language
  const where = (target) => {
    const el = find(target);
    if (!el) return null;
    const parts = [];
    for (let e = el; e && e.parentElement && e !== document.body; e = e.parentElement) { let n = 1; for (let b = e.previousElementSibling; b; b = b.previousElementSibling) n++; parts.unshift("*:nth-child(" + n + ")"); }
    return "body>" + parts.join(">");
  };
  window.__g = { find, rect, mark, tidy, grow, where, text: () => norm(document.body.innerText) };
})()`;

const s0 = (list) => list[0] ?? {};

async function run() {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const shots = SHOTS.filter((s) => !filters.length || filters.some((f) => s.id.startsWith(f)));
  if (!shots.length) { console.error("No picture matches."); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  const made = [];
  const langBefore = new Map();
  // each run takes its own Chrome port, so two pictures-runs (or a picture-run and a build) can work at the same time
  const browser = await launch({ port: 9400 + Math.floor(Math.random() * 500) });
  const problems = [];
  try {
    // one browser profile per person and language
    const groups = new Map();
    for (const s of shots) { const k = `${s.as ?? "visitor"}|${s.lang ?? "en"}|${s.view ?? "desk"}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }

    for (const [key, list] of groups) {
      const [who, lang, viewName] = key.split("|");
      const view = VIEW[viewName];
      const ctx = await browser.context();
      const page = await ctx.page();
      await page.cmd("Emulation.setDeviceMetricsOverride", view);
      if (view.mobile) {
        await page.cmd("Emulation.setUserAgentOverride", { userAgent: PHONE_UA });
        await page.cmd("Emulation.setTouchEmulationEnabled", { enabled: true });
      }
      // the books are printed: every picture is taken in the light look
      await page.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s0(list).dark ? "dark" : "light" }] });
      await page.cmd("Network.enable");
      await page.cmd("Network.setCookie", { name: "vlh-lang", value: lang === "zh" ? "zh-CN" : "en", domain: "localhost", path: "/" });
      if (who !== "visitor") {
        const u = (await db.query(`SELECT id, "preferredLanguage" FROM users WHERE email = $1`, [who])).rows[0];
        if (!u) { problems.push(`${who}: no such practice account`); await ctx.close(); continue; }
        if (!langBefore.has(u.id)) langBefore.set(u.id, u.preferredLanguage);
        await db.query(`UPDATE users SET "preferredLanguage" = $2 WHERE id = $1`, [u.id, lang === "zh" ? "zh-CN" : "en"]);
        const token = crypto.randomBytes(32).toString("base64url");
        const id = "guide_" + crypto.randomBytes(8).toString("hex");
        await db.query(`INSERT INTO sessions (id, "tokenHash", "userId", "expiresAt", "createdAt", "lastSeenAt", "userAgent") VALUES ($1, $2, $3, now() + interval '3 hours', now(), now(), 'guide pictures')`,
          [id, crypto.createHash("sha256").update(token).digest("hex"), u.id]);
        made.push(id);
        await page.cmd("Network.setCookie", { name: "vlh_session", value: token, domain: "localhost", path: "/", httpOnly: true });
      }

      for (const s of list) {
        try {
          const h = s.h ?? view.height;
          // "like": the same page in another language — every thing is found by its place, as the named picture found it by its words
          const likePaths = s.like ? JSON.parse(fs.readFileSync(path.join(OUT, `${s.like}.txt`), "utf8")).paths ?? [] : null;
          const paths = [];
          let pi = 0;
          const at = async (target) => {
            if (likePaths) { const p = likePaths[pi++]; return p ? "css:" + p : target; }
            paths.push(await page.evaluate(`__g.where(${JSON.stringify(target)})`));
            return target;
          };
          await page.cmd("Emulation.setDeviceMetricsOverride", { ...view, height: h });
          if (s.url) await page.goto(BASE + s.url);
          await page.evaluate(HELPERS);
          await page.evaluate("__g.tidy()");
          // the numbers drawn for the picture before this one must not stay on this one
          await page.evaluate("document.querySelectorAll('[data-guide-mark]').forEach((e) => e.remove())");
          if (s.top) { await page.evaluate("scrollTo(0, 0)"); await sleep(300); }
          for (const step of s.steps ?? []) {
            if (step.wait) await sleep(step.wait);
            else if (step.js) await page.evaluate(step.js);
            else if (step.goto) { await page.goto(BASE + step.goto); await page.evaluate(HELPERS); await page.evaluate("__g.tidy()"); }
            else if (step.key) {
              await page.cmd("Input.dispatchKeyEvent", { type: "keyDown", key: step.key, code: step.key, windowsVirtualKeyCode: step.key === "Enter" ? 13 : step.key === "Escape" ? 27 : 0 });
              await page.cmd("Input.dispatchKeyEvent", { type: "keyUp", key: step.key, code: step.key });
              await sleep(step.then ?? 500);
            } else if (step.click || step.type !== undefined) {
              const target = await at(step.click ?? step.into);
              const r = await page.evaluate(`__g.rect(${JSON.stringify(target)}, true)`);
              if (!r) { if (step.optional) continue; throw new Error(`could not find "${target}"`); }
              await sleep(120);
              const p = await page.evaluate(`__g.rect(${JSON.stringify(target)}, false)`);
              const x = p.x + p.w / 2, y = p.y + p.h / 2;
              await page.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
              await page.cmd("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
              await page.cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
              if (step.type !== undefined) { await sleep(150); await page.cmd("Input.insertText", { text: step.type }); }
              await sleep(step.then ?? 900);
              await page.evaluate(HELPERS);
              await page.evaluate("__g.tidy()");
            }
          }
          if (s.full) {
            const extra = await page.evaluate("__g.grow()");
            if (extra > 0) { await page.cmd("Emulation.setDeviceMetricsOverride", { ...view, height: Math.min(h + extra + 8, s.max ?? 2600) }); await sleep(700); }
          }
          if (s.scroll === "top") { await page.evaluate("scrollTo(0, 0); document.querySelectorAll('main, [data-scroll], .overflow-y-auto').forEach((e) => { e.scrollTop = 0; })"); await sleep(400); }
          else if (s.scroll) { await page.evaluate(`__g.rect(${JSON.stringify(await at(s.scroll))}, true)`); await sleep(400); }
          for (const m of s.marks ?? []) {
            const ok = await page.evaluate(`__g.mark(${JSON.stringify(String(m[0]))}, ${JSON.stringify(await at(m[1]))}, ${JSON.stringify(m[2] ?? {})})`);
            if (!ok) problems.push(`${s.id}: mark ${m[0]} — could not find "${m[1]}"`);
          }
          const shot = { format: "jpeg", quality: s.quality ?? 84 };
          if (s.clip) { // one thing, or the smallest box that holds several things (a whole card: its first and its last line)
            const rs = [];
            for (const t0 of [].concat(s.clip)) {
              const t = await at(t0);
              const r = await page.evaluate(`__g.rect(${JSON.stringify(t)}, false)`);
              if (r) rs.push(r); else problems.push(`${s.id}: clip — could not find "${t}"`);
            }
            if (rs.length) {
              const pad = s.pad ?? 14;
              const x0 = Math.min(...rs.map((r) => r.px)), y0 = Math.min(...rs.map((r) => r.py));
              const x1 = Math.max(...rs.map((r) => r.px + r.w)), y1 = Math.max(...rs.map((r) => r.py + r.h));
              shot.clip = { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2 + (s.below ?? 0), scale: 1 };
              shot.captureBeyondViewport = true;
            }
          }
          const { data } = await page.cmd("Page.captureScreenshot", shot);
          fs.writeFileSync(path.join(OUT, `${s.id}.jpg`), Buffer.from(data, "base64"));
          const info = await page.evaluate("JSON.stringify({ view: " + JSON.stringify(s.view ?? "desk") + ", clip: " + !!s.clip + ", url: location.pathname + location.search, title: document.title, text: __g.text().slice(0, " + (s.chars ?? 2600) + ") })");
          fs.writeFileSync(path.join(OUT, `${s.id}.txt`), JSON.stringify({ ...JSON.parse(info), paths }));
          const landed = JSON.parse(info).url;
          if (who !== "visitor" && /\/login/.test(landed)) problems.push(`${s.id}: landed on the sign-in page`);
          console.log(`  ok  ${s.id.padEnd(26)} ${landed}`);
        } catch (e) {
          problems.push(`${s.id}: ${e.message}`);
          console.log(`  !!  ${s.id.padEnd(26)} ${e.message}`);
        }
      }
      await ctx.close();
    }
  } finally {
    for (const [id, lang] of langBefore) await db.query(`UPDATE users SET "preferredLanguage" = $2 WHERE id = $1`, [id, lang]).catch(() => null);
    if (made.length) await db.query(`DELETE FROM sessions WHERE id = ANY($1)`, [made]).catch(() => null);
    await db.end().catch(() => null);
    await browser.close();
  }
  console.log(problems.length ? `\n${problems.length} to look at:\n  - ${problems.join("\n  - ")}` : "\nAll pictures taken.");
}

run().catch((e) => { console.error("Stopped — " + String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "[address]")); process.exit(1); });
