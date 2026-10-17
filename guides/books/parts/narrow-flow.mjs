// Like `flow` of the kit (a few phone pictures in a row, one per step), but the row can be narrower than the page
// (`width`, in percent, centred) so that two rows fit on one page. Used by the books of the checking pass (02 Waiters …).
import { fmt, shot, render } from "../../tools/kit.mjs";

export const flowN = (title, o) => (c) => {
  const no = c.next();
  const n = o.shots.length;
  const w = o.width ?? 80;
  return `<article class="task"><div class="keep"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header>${o.when ? `<p class="when"><b>${c.L.when}</b>${fmt(o.when)}</p>` : ""}${o.intro ? `<p class="txt" style="margin-left:11mm">${fmt(o.intro)}</p>` : ""}
    <div class="flow n${n}" style="--n:${n};width:${w}%;margin:3mm auto 0">${o.shots.map(([id, text], i) => `<figure>${shot(id, { frame: o.frame ?? "phone", wrap: "", tall: o.tall }).replace(/^<figure class="[^"]*">|<\/figure>$/g, "")}<figcaption>${o.plain ? "" : `<span class="n">${(o.from ?? 1) + i}</span>`}<span>${fmt(text)}</span></figcaption></figure>`).join("")}</div></div>${render(c, o.notes)}</article>`;
};
