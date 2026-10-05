import { ImageResponse } from "next/og";
import sharp from "sharp";

/**
 * THE LINK CARDS — the picture WhatsApp, Facebook and others show when someone shares a link to the hotel (owner,
 * 2026-10-05: "when I share the link it should come with a nice thing like Book your stay — nice pictures, not
 * nothing"). One designed 1200×630 card per kind: the hotel's own photograph on the right melting into deep espresso,
 * the crest and VEGAS wordmark, one big serif line, one plain line and the mobile-money marks. Real photos only (the
 * menu's dish photo is free-licence stock, so it says "Illustrative" on it). Cached at the edge for a week.
 */

const KINDS = {
  hotel: {
    eyebrow: "Mlimani City · Dar es Salaam",
    title: "Your stay,",
    accent: "elevated.",
    line: "Rooms with breakfast · Restaurant & bar · Meeting room",
    cta: "Book your stay",
    photo: "/images/room-red/room-red-08.webp",
    illustrative: false,
  },
  book: {
    eyebrow: "Book direct",
    title: "Book your",
    accent: "stay.",
    line: "Pick your dates, pay by mobile money — done in a minute.",
    cta: "Book now",
    photo: "/images/room-red/room-red-10.webp",
    illustrative: false,
  },
  menu: {
    eyebrow: "Restaurant & bar",
    title: "Our",
    accent: "menu.",
    line: "Eat here or take out — order online, pay by mobile money.",
    cta: "Order now",
    photo: "/images/menu/mi_local_favorites_nyama_choma_beef.webp",
    illustrative: true,
  },
} as const;
type Kind = keyof typeof KINDS;

const W = 1200, H = 630, PHOTO_W = 560;
const GOLD = "#e3bd6a", INK = "#f3ece0", NIGHT = "#0f0c09";

/** The marks of the mobile-money networks (as on the site): brand colours, small. */
const MARKS = [
  { label: "m-pesa", bg: "#e60000", fg: "#ffffff", dot: "#7ab800" },
  { label: "airtel", bg: "#ffffff", fg: "#e40000" },
  { label: "mixx by yas", bg: "#0b2a7a", fg: "#ffd100" },
  { label: "halopesa", bg: "#f15a22", fg: "#ffffff" },
];

/** A photo from the site, as a JPEG data URI cut to the card's photo side (Satori does not read WebP). */
async function photoUri(origin: string, path: string, w: number, h: number) {
  try {
    const res = await fetch(new URL(path, origin), { cache: "force-cache" });
    if (!res.ok) return null;
    const jpg = await sharp(Buffer.from(await res.arrayBuffer())).resize(w, h, { fit: "cover", position: "attention" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpg.toString("base64")}`;
  } catch { return null; }
}

async function logoUri(origin: string) {
  try {
    const res = await fetch(new URL("/brand/logo-192.png", origin), { cache: "force-cache" });
    if (!res.ok) return null;
    return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch { return null; }
}

/** The site's own fonts (Cormorant Garamond, Inter), only the letters this card uses; none — the default font. */
async function googleFont(family: string, weight: number, text: string) {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&text=${encodeURIComponent(text)}`, { cache: "force-cache" })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { cache: "force-cache" });
    return res.ok ? await res.arrayBuffer() : null;
  } catch { return null; }
}

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind: raw } = await ctx.params;
  const kind: Kind = raw in KINDS ? (raw as Kind) : "hotel";
  const k = KINDS[kind];
  const origin = new URL(req.url).origin;

  const serifText = `VEGAS${k.title} ${k.accent}`;
  const sansText = `LUXURY HOTEL${k.eyebrow.toUpperCase()}${k.line}${k.cta} →${MARKS.map((m) => m.label).join("")}Illustrative`;
  const [photo, logo, serif, sans, sansBold] = await Promise.all([
    photoUri(origin, k.photo, PHOTO_W + 120, H),
    logoUri(origin),
    googleFont("Cormorant Garamond", 600, serifText),
    googleFont("Inter", 500, sansText),
    googleFont("Inter", 700, sansText),
  ]);
  const fonts = [
    ...(serif ? [{ name: "Cormorant", data: serif, weight: 600 as const, style: "normal" as const }] : []),
    ...(sans ? [{ name: "Inter", data: sans, weight: 500 as const, style: "normal" as const }] : []),
    ...(sansBold ? [{ name: "Inter", data: sansBold, weight: 700 as const, style: "normal" as const }] : []),
  ];
  const serifFamily = serif ? "Cormorant" : "serif";
  const sansFamily = sans ? "Inter" : "sans-serif";

  const png = new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", background: NIGHT, fontFamily: sansFamily, color: INK }}>
        {/* The photo, right, melting into the night */}
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- an image inside a generated picture
          <img src={photo} width={PHOTO_W + 120} height={H} style={{ position: "absolute", right: 0, top: 0, width: PHOTO_W + 120, height: H, objectFit: "cover" }} />
        )}
        <div style={{ position: "absolute", right: 0, top: 0, width: PHOTO_W + 120, height: H, display: "flex", backgroundImage: `linear-gradient(90deg, ${NIGHT} 0%, rgba(15,12,9,0.82) 16%, rgba(15,12,9,0.25) 46%, rgba(15,12,9,0.05) 100%)` }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, display: "flex", backgroundImage: "radial-gradient(70% 90% at 12% 85%, rgba(227,189,106,0.16), rgba(15,12,9,0) 70%)" }} />
        {k.illustrative && (
          <div style={{ position: "absolute", right: 22, bottom: 20, display: "flex", fontSize: 15, color: "rgba(243,236,224,0.75)", letterSpacing: 1 }}>Illustrative</div>
        )}

        {/* A thin gold frame */}
        <div style={{ position: "absolute", left: 22, top: 22, width: W - 44, height: H - 44, display: "flex", border: "1px solid rgba(227,189,106,0.35)", borderRadius: 18 }} />

        {/* The words */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: 700, height: H, padding: "62px 0 58px 72px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- an image inside a generated picture
              <img src={logo} width={64} height={64} style={{ width: 64, height: 64, borderRadius: 999 }} />
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontFamily: serifFamily, fontSize: 40, fontWeight: 600, letterSpacing: 9, color: GOLD, lineHeight: 1 }}>VEGAS</div>
              <div style={{ display: "flex", marginTop: 8, fontSize: 14, fontWeight: 700, letterSpacing: 7, color: "rgba(243,236,224,0.85)" }}>LUXURY HOTEL</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 17, fontWeight: 700, letterSpacing: 5, color: GOLD }}>
              <div style={{ display: "flex", width: 34, height: 1, background: GOLD }} />
              {k.eyebrow.toUpperCase()}
            </div>
            <div style={{ display: "flex", marginTop: 18, fontFamily: serifFamily, fontSize: 98, fontWeight: 600, lineHeight: 1, letterSpacing: -1 }}>
              {k.title}&nbsp;<span style={{ color: GOLD }}>{k.accent}</span>
            </div>
            <div style={{ display: "flex", marginTop: 22, fontSize: 26, fontWeight: 500, color: "rgba(243,236,224,0.78)", lineHeight: 1.35, maxWidth: 600 }}>{k.line}</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, whiteSpace: "nowrap", height: 52, padding: "0 26px", border: `1.5px solid ${GOLD}`, borderRadius: 999, fontSize: 22, fontWeight: 700, color: GOLD }}>{k.cta} →</div>
            <div style={{ display: "flex", gap: 8 }}>
              {MARKS.map((m) => (
                <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 7, background: m.bg, color: m.fg, fontSize: 15, fontWeight: 700 }}>
                  {"dot" in m && <div style={{ display: "flex", width: 9, height: 9, borderRadius: 999, background: m.dot }} />}
                  {m.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts },
  );
  // A light JPEG: WhatsApp skips link pictures much over ~300 KB (the PNG is 600–900 KB).
  const jpg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400" },
  });
}
