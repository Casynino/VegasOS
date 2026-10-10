import { englishT, type T } from "@/i18n/translate";

/** "iPhone · Safari", "Mac · Chrome" … from a user-agent string (the unknown parts in the reader's language when their `t` is given). */
export function deviceLabel(ua: string | null, t: T = englishT): { label: string; phone: boolean } {
  if (!ua) return { label: t("Unknown device"), phone: false };
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { label: `${os === "Device" ? t("Device") : os} · ${browser === "Browser" ? t("Browser") : browser}`, phone: ["iPhone", "Android"].includes(os) };
}
