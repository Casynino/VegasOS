// A quick look at many pictures at once: lays the chosen pictures out on one sheet (for checking, not for the books).
//   node guides/tools/sheet.mjs <out-folder> [id-prefix…] [--cols=3] [--per=6]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./chrome.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => +(args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const [out, ...prefixes] = args.filter((a) => !a.startsWith("--"));
const cols = opt("cols", 3), per = opt("per", 6), width = opt("width", 1800);
const dir = path.join(process.cwd(), "guides", "shots");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg") && (!prefixes.length || prefixes.some((p) => f.startsWith(p)))).sort();
fs.mkdirSync(out, { recursive: true });

const browser = await launch({ port: 9334 });
try {
  const page = await (await browser.context()).page();
  for (let i = 0, n = 1; i < files.length; i += per, n++) {
    const cells = files.slice(i, i + per).map((f) => `<figure><img src="${pathToFileURL(path.join(dir, f))}"><figcaption>${f.replace(".jpg", "")}</figcaption></figure>`).join("");
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:14px;background:#555;font:600 15px -apple-system,Arial}main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;align-items:start}figure{margin:0;background:#fff}img{display:block;width:100%}figcaption{padding:5px 8px;background:#111;color:#ffd77a}</style><main>${cells}</main>`;
    const file = path.join(out, `sheet-${String(n).padStart(2, "0")}.html`);
    fs.writeFileSync(file, html);
    await page.cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.goto(pathToFileURL(file).href, { settle: 300 });
    const h = await page.evaluate("document.documentElement.scrollHeight");
    await page.cmd("Emulation.setDeviceMetricsOverride", { width, height: Math.min(h, 4000), deviceScaleFactor: 1, mobile: false });
    const { data } = await page.cmd("Page.captureScreenshot", { format: "jpeg", quality: 72 });
    fs.writeFileSync(file.replace(".html", ".jpg"), Buffer.from(data, "base64"));
    fs.rmSync(file);
    console.log(file.replace(".html", ".jpg"));
  }
} finally { await browser.close(); }
