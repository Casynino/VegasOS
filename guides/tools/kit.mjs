// The building blocks of a guide book: each one turns plain words and a picture name into a piece of the printed page.
// A book (guides/books/*.mjs) is a list of chapters made from these; build.mjs lays them out and prints the PDF.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SHOTS = path.join(process.cwd(), "guides", "shots");
export const missing = new Set();

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Words for the page: **strong**, [[a button or menu name]], [[!the main button]], ((3)) a number as on the picture. */
export const fmt = (s) => esc(s)
  .replace(/\[\[!(.+?)\]\]/g, '<span class="ui go">$1</span>')
  .replace(/\[\[(.+?)\]\]/g, '<span class="ui">$1</span>')
  .replace(/\(\((\d+)\)\)/g, '<span class="n">$1</span>')
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
/** "Do this | a smaller line under it" */
const line = (s) => { const [a, b] = String(s).split(" | "); return fmt(a) + (b ? `<small>${fmt(b)}</small>` : ""); };

function jpegSize(file) {
  const b = fs.readFileSync(file);
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return { w: 0, h: 0 };
}
const info = (id) => {
  const jpg = path.join(SHOTS, id + ".jpg");
  if (!fs.existsSync(jpg)) { missing.add(id); return null; }
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(SHOTS, id + ".txt"), "utf8")); } catch { /* a picture without its notes */ }
  const size = jpegSize(jpg);
  const view = meta.clip ? "crop" : meta.view ?? (size.w <= 800 ? "phone" : size.w <= 1540 ? "tablet" : "desk");
  return { src: pathToFileURL(jpg).href, view, ...size };
};

/** One picture in its frame: a computer window, a tablet, a phone, a sheet of paper, or a plain cut-out. */
export function shot(id, o = {}) {
  const i = info(id);
  if (!i) return `<figure class="fig ${o.size ?? ""}"><div class="shot desk" style="height:40mm;display:grid;place-items:center;color:#f66">${esc(id)}</div></figure>`;
  const frame = o.frame ?? (i.view === "crop" ? "desk" : i.view);
  const tall = frame === "phone" && (o.tall || i.h / i.w < 1.9) ? " tall" : "";
  const bar = frame === "desk" && !o.bare && i.view !== "crop" ? `<div class="bar"><i></i><i></i><i></i><span>${esc(o.label ?? "Vegas Luxury Hotel")}</span></div>` : "";
  return `<figure class="${o.wrap ?? "fig"} ${o.size ?? ""}"${o.w ? ` style="width:${o.w}%"` : ""}><div class="shot ${frame}${tall}">${bar}<img src="${i.src}" alt=""></div>${o.cap ? `<figcaption class="cap">${fmt(o.cap)}</figcaption>` : ""}</figure>`;
}

export const note = (kind, text) => (c) => `<div class="note ${kind}"><span class="k">${c.L.note[kind]}</span><div><p>${fmt(text)}</p></div></div>`;
export const tip = (t) => note("tip", t);
export const warn = (t) => note("warn", t);
export const rule = (t) => note("rule", t);

export const h = (text) => `<h3 class="h">${fmt(text)}</h3>`;
export const p = (...texts) => texts.map((t) => `<p class="txt">${fmt(t)}</p>`).join("");
export const dots = (items, cols = false) => `<ul class="dots${cols ? " cols" : ""}">${items.map((t) => `<li>${line(t)}</li>`).join("")}</ul>`;
export const table = (head, rows, cls = "") => `<table class="t ${cls}"><thead><tr>${head.map((x) => `<th>${fmt(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x) => `<td>${fmt(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
export const cards = (items, n = 2) => `<div class="cards" style="--n:${n}">${items.map(([k, t, body, dark]) => `<div class="card${dark ? " dark" : ""}">${k ? `<div class="ck">${fmt(k)}</div>` : ""}<b class="ct">${fmt(t)}</b><p>${fmt(body)}</p></div>`).join("")}</div>`;
export const rules = (items) => `<ol class="rules">${items.map(([t, body]) => `<li><b>${fmt(t)}</b>${fmt(body)}</li>`).join("")}</ol>`;
export const pair = (a, b) => `<div class="pair">${shot(a[0], { ...a[1], wrap: "" })}${shot(b[0], { ...b[1], wrap: "" })}</div>`;
const run = (c, blocks) => (blocks ?? []).map((b) => (typeof b === "function" ? b(c) : b)).join("");

/**
 * A task, step by step. The numbers of the steps are the numbers on the picture.
 *   task("Check a guest in", { when: "…", shot: "rec-checkin", steps: ["…"], notes: [tip("…")] })
 * A phone picture sits beside the steps; a computer or tablet picture sits above them.
 */
export const task = (title, o) => (c) => {
  const no = c.next();
  const head = `<header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header>`;
  const when = o.when ? `<p class="when"><b>${c.L.when}</b>${fmt(o.when)}</p>` : "";
  const intro = o.intro ? `<p class="txt" style="margin-left:11mm">${fmt(o.intro)}</p>` : "";
  const steps = o.steps?.length ? `<ol class="steps${o.cols === false || o.steps.length < 4 ? "" : " cols"}">${o.steps.map((s) => `<li>${line(s)}</li>`).join("")}</ol>` : "";
  const notes = run(c, o.notes);
  const ids = o.shots ?? (o.shot ? [o.shot] : []);
  const first = ids[0] ? info(ids[0]) : null;
  const frame = o.frame ?? first?.view;
  if (first && o.side) {
    return `<article class="task">${head}<div class="split" style="grid-template-columns:1fr ${o.side}mm"><div>${when.replace('class="when"', 'class="when" style="margin-left:0"')}${intro.replace("margin-left:11mm", "margin-left:0")}${steps.replace(" cols", "")}${notes}</div>${shot(ids[0], { frame: o.frame, wrap: "", cap: o.cap })}</div></article>`;
  }
  if (first && frame === "phone") {
    const pics = ids.slice(0, 2).map((id) => shot(id, { frame: "phone", wrap: "", tall: o.tall })).join("");
    return `<article class="task">${head}<div class="split${ids.length > 1 ? " two" : ""}"><div>${when.replace('class="when"', 'class="when" style="margin-left:0"')}${intro.replace("margin-left:11mm", "margin-left:0")}${steps.replace(" cols", "")}${notes}</div>${pics}</div></article>`;
  }
  const pics = ids.length === 2 ? pair([ids[0], { label: o.label }], [ids[1], { label: o.label2 ?? o.label }]) : ids.map((id) => shot(id, { frame: o.frame, label: o.label, size: o.size, cap: o.cap, w: o.w })).join("");
  return `<article class="task"><div class="keep">${head}${when}${intro}${pics}</div>${steps}${notes}</article>`;
};

/** A picture with numbers on it, and what each number is. */
export const tour = (title, o) => (c) => {
  const no = c.next();
  const items = `<ol class="legend${o.cols === 3 ? " c3" : ""}">${o.items.map((s) => `<li>${line(s)}</li>`).join("")}</ol>`;
  const first = info(o.shot);
  if (o.side) {
    return `<article class="task"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header><div class="split" style="grid-template-columns:1fr ${o.side}mm"><div>${o.intro ? `<p class="txt">${fmt(o.intro)}</p>` : ""}${items.replace('class="legend', 'style="columns:1" class="legend')}${run(c, o.notes)}</div>${shot(o.shot, { frame: o.frame, wrap: "" })}</div></article>`;
  }
  if ((o.frame ?? first?.view) === "phone") {
    return `<article class="task"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header><div class="split"><div>${o.intro ? `<p class="txt">${fmt(o.intro)}</p>` : ""}${items.replace('class="legend', 'style="columns:1" class="legend')}${run(c, o.notes)}</div>${shot(o.shot, { frame: "phone", wrap: "", tall: o.tall })}</div></article>`;
  }
  return `<article class="task"><div class="keep"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header>${o.intro ? `<p class="txt" style="margin-left:11mm">${fmt(o.intro)}</p>` : ""}${shot(o.shot, { frame: o.frame, label: o.label, size: o.size, w: o.w })}</div>${items}${run(c, o.notes)}</article>`;
};

/** A few phone pictures in a row, one per step. plain: no step numbers under them (the words point at the numbers on the pictures). */
export const flow = (title, o) => (c) => {
  const no = c.next();
  const n = o.shots.length;
  return `<article class="task"><div class="keep"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header>${o.when ? `<p class="when"><b>${c.L.when}</b>${fmt(o.when)}</p>` : ""}${o.intro ? `<p class="txt" style="margin-left:11mm">${fmt(o.intro)}</p>` : ""}
    <div class="flow n${n}" style="--n:${Math.max(n, o.min ?? 3)}">${o.shots.map(([id, text], i) => `<figure>${shot(id, { frame: o.frame ?? "phone", wrap: "", tall: o.tall }).replace(/^<figure class="[^"]*">|<\/figure>$/g, "")}<figcaption>${o.plain ? "" : `<span class="n">${(o.from ?? 1) + i}</span>`}<span>${fmt(text)}</span></figcaption></figure>`).join("")}</div></div>${run(c, o.notes)}</article>`;
};

/** A small picture beside some words. */
export const beside = (id, mm, ...blocks) => (c) => `<div class="split" style="grid-template-columns:1fr ${mm}mm;margin:0 0 4mm"><div>${run(c, blocks)}</div>${shot(id, { wrap: "" })}</div>`;

/** Blocks that must stay on one page: a heading, its words and its picture. */
export const keep = (...blocks) => (c) => `<div class="keep">${run(c, blocks)}</div>`;

/** A chapter: its name, a line or two about it, then its blocks. */
export const chapter = (title, lead, ...blocks) => ({ title, lead, blocks });
export const render = run;
