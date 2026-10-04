import QRCode from "qrcode";

/**
 * A QR code as SVG, made synchronously (works in the browser and on the server).
 * Level H by default: the logo placed in the middle never stops it scanning.
 */
export function qrSvg(text: string, color = "#0b1026", level: "M" | "H" = "H") {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: level });
  const n = modules.size;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(y, x)) continue;
      // Join dark modules in a row into one run.
      let w = 1;
      while (x + w < n && modules.get(y, x + w)) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path fill="${color}" d="${d}"/></svg>`;
}
