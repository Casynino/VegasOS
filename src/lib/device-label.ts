/** "iPhone · Safari", "Mac · Chrome" … from a user-agent string. */
export function deviceLabel(ua: string | null): { label: string; phone: boolean } {
  if (!ua) return { label: "Unknown device", phone: false };
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { label: `${os} · ${browser}`, phone: ["iPhone", "Android"].includes(os) };
}
