import type { CSSProperties } from "react";

/**
 * The picture behind the staff sign-in (owner, 2026-11-09: "a very nice animated background, on phone and computer"):
 * the hotel at night. A gold-lit tower and its neighbours stand on a polished floor that mirrors them, windows switch on
 * and off one by one, two searchlights sweep the sky, gold dust drifts up from the city and a thin light slides over the floor.
 * Pure SVG + CSS (no image, no script), decorative (aria-hidden), and still when the visitor asked for less motion.
 * Sizes and colours live in login.css. Everything is drawn from fixed numbers, so the server and the browser agree.
 */

const W = 1600;
const H = 440; // the drawing is 1600 x 440; the tower stands at the middle (x = 800), so a phone, which shows only the middle, still shows it whole

/** A small fixed "random" (mulberry32): the same picture every time. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Block = [x: number, w: number, h: number];

/** The hotel and the buildings close to it (in front). */
const NEAR: Block[] = [
  [738, 124, 340], [628, 96, 230], [876, 104, 265], [548, 74, 160], [986, 84, 190], [462, 76, 122],
  [1076, 78, 138], [372, 84, 96], [1160, 90, 116], [270, 92, 84], [1256, 80, 102], [176, 84, 66], [1348, 90, 78],
];

/** The city further back: paler, lower, with fewer lit windows. */
function farBlocks(): Block[] {
  const r = rng(7);
  const out: Block[] = [];
  for (let x = -12; x < W; ) {
    const w = 44 + Math.round(r() * 50);
    const middle = 1 - Math.abs(x + w / 2 - W / 2) / (W / 2);
    out.push([x, w, 70 + Math.round(r() * 100 + middle * 56)]);
    x += w - 6;
  }
  return out;
}

const silhouette = (bs: Block[]) => bs.map(([x, w, h]) => `M${x} ${H}V${H - h}h${w}V${H}z`).join("");

/** Lit windows as ONE path per kind (8 kinds: six that switch on and off at their own pace, a steady gold and a rare white), so the drawing stays light. */
function windows(bs: Block[], o: { ww: number; wh: number; gx: number; gy: number; lit: number; top: number }, seed: number) {
  const r = rng(seed);
  const kinds: string[] = Array(8).fill("");
  for (const [x, w, h] of bs) {
    const cols = Math.floor((w - 12 + o.gx) / (o.ww + o.gx));
    const rows = Math.floor((h - o.top - 8 + o.gy) / (o.wh + o.gy));
    const left = x + Math.round((w - (cols * (o.ww + o.gx) - o.gx)) / 2);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (r() > o.lit) continue;
        const k = r() < 0.6 ? Math.floor(r() * 6) : r() < 0.88 ? 6 : 7;
        kinds[k] += `M${left + col * (o.ww + o.gx)} ${H - h + o.top + row * (o.wh + o.gy)}h${o.ww}v${o.wh}h-${o.ww}z`;
      }
    }
  }
  return kinds;
}

const FAR = farBlocks();
const FAR_WINDOWS = windows(FAR, { ww: 4, wh: 5, gx: 5, gy: 6, lit: 0.3, top: 10 }, 21);
const NEAR_WINDOWS = windows(NEAR, { ww: 6, wh: 8, gx: 5, gy: 6, lit: 0.52, top: 14 }, 5);

const vars = (v: Record<string, string>) => v as CSSProperties;

const r = rng(11);
const STARS = Array.from({ length: 34 }, (_, i) => ({
  g: i % 3,
  left: `${(r() * 100).toFixed(1)}%`,
  top: `${(r() * 46).toFixed(1)}%`,
  size: r() < 0.2 ? 2 : 1.5,
}));
const DUST = Array.from({ length: 14 }, (_, i) => ({
  l: `${(6 + (i * 6.7 + r() * 5) % 90).toFixed(1)}%`,
  s: `${(2 + r() * 2.4).toFixed(1)}px`,
  d: `${(13 + r() * 10).toFixed(1)}s`,
  delay: `-${(r() * 20).toFixed(1)}s`,
  dx: `${Math.round((r() - 0.5) * 70)}px`,
}));
const RIPPLES = [
  { t: "14%", w: "34cqw", d: "11s", delay: "-3s" },
  { t: "34%", w: "22cqw", d: "15s", delay: "-9s" },
  { t: "56%", w: "40cqw", d: "13s", delay: "-6s" },
  { t: "78%", w: "26cqw", d: "18s", delay: "-12s" },
];
const KIND_CLASS = ["vg-w vg-w0", "vg-w vg-w1", "vg-w vg-w2", "vg-w vg-w3", "vg-w vg-w4", "vg-w vg-w5", "", ""];
const KIND_FILL = ["#f5d58a", "#f5d58a", "#f5d58a", "#f5d58a", "#f5d58a", "#f5d58a", "#f0c872", "#fff1d2"];

export function LoginScene() {
  return (
    <div className="vg-scene" aria-hidden="true">
      <span className="vg-glow vg-glow-a" />
      <span className="vg-glow vg-glow-b" />
      {[0, 1, 2].map((g) => (
        <div key={g} className={`vg-stars vg-stars-${g}`}>
          {STARS.filter((s) => s.g === g).map((s, i) => (
            <span key={i} className="vg-star" style={{ left: s.left, top: s.top, width: s.size, height: s.size }} />
          ))}
        </div>
      ))}
      <span className="vg-halo" />
      <span className="vg-beam vg-beam-l" />
      <span className="vg-beam vg-beam-r" />

      <div className="vg-sky">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" focusable="false">
          <g id="vg-city">
            <path d={silhouette(FAR)} fill="#1c160d" />
            {FAR_WINDOWS.map((d, k) => d && <path key={`f${k}`} d={d} fill={KIND_FILL[k]} fillOpacity={0.55} className={KIND_CLASS[k]} style={vars({ "--k": String(k) })} />)}
            <path d={silhouette(NEAR)} fill="#0c0905" />
            {/* the hotel's crown: two steps, a mast and a light that blinks, and a gold band of light under the top */}
            <path d="M752 100V76h96v24zM774 76V58h52v18zM799 58V22h2v36z" fill="#0c0905" />
            <rect x="752" y="86" width="96" height="2" fill="#f6d68a" fillOpacity="0.85" />
            <rect x="748" y="82" width="104" height="10" fill="#f6d68a" fillOpacity="0.12" />
            <circle cx="800" cy="20" r="3" fill="#ffe3a3" className="vg-beacon" />
            {NEAR_WINDOWS.map((d, k) => d && <path key={`n${k}`} d={d} fill={KIND_FILL[k]} className={KIND_CLASS[k]} style={vars({ "--k": String(k) })} />)}
          </g>
        </svg>
      </div>
      <div className="vg-horizon" />
      <div className="vg-floor">
        <div className="vg-sky-r">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" focusable="false">
            <use href="#vg-city" />
          </svg>
        </div>
        {RIPPLES.map((p, i) => (
          <span key={i} className="vg-ripple" style={vars({ "--t": p.t, "--w": p.w, "--d": p.d, "--s": p.delay })} />
        ))}
      </div>
      {DUST.map((p, i) => (
        <span key={i} className="vg-dust" style={vars({ "--l": p.l, "--z": p.s, "--d": p.d, "--s": p.delay, "--dx": p.dx })} />
      ))}
      <div className="vg-vignette" />
    </div>
  );
}
