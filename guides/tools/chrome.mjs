// A small driver for the Chrome already on this computer (no extra packages): opens it without a window,
// talks to it over its own debugging channel, and gives back pages that can be loaded, clicked, pictured and printed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vegas-guides-"));
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--force-color-profile=srgb", "about:blank",
  ], { stdio: "ignore" });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { /* not up yet */ }
  }
  if (!wsUrl) { child.kill(); throw new Error("Chrome did not start."); }

  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("Could not reach Chrome.")); });
  let seq = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { ok, bad, method } = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) bad(new Error(`${method}: ${m.error.message}`)); else ok(m.result);
    } else if (m.method) for (const l of listeners) l(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
    const id = ++seq;
    waiting.set(id, { ok, bad, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  /** A separate browser profile (its own cookies) — one per signed-in person. */
  async function context() {
    const { browserContextId } = await send("Target.createBrowserContext");
    return {
      async page() {
        const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
        const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
        const cmd = (method, params) => send(method, params, sessionId);
        await cmd("Page.enable");
        await cmd("Runtime.enable");
        const once = (name, ms = 45000) => new Promise((ok, bad) => {
          const t = setTimeout(() => { listeners.delete(l); bad(new Error(`Timed out waiting for ${name}`)); }, ms);
          const l = (m) => { if (m.sessionId === sessionId && m.method === name) { clearTimeout(t); listeners.delete(l); ok(m.params); } };
          listeners.add(l);
        });
        const evaluate = async (expression) => {
          const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
          return r.result.value;
        };
        return {
          cmd, once, evaluate,
          async goto(url, { settle = 900 } = {}) {
            const loaded = once("Page.loadEventFired").catch(() => null);
            await cmd("Page.navigate", { url });
            await loaded;
            await sleep(settle);
            // wait until the page has stopped changing: no "loading" placeholders left and the same text three looks in a
            // row (the practice copy builds each page the first time it is opened)
            let last = "", same = 0;
            for (let i = 0; i < 70 && same < 3; i++) {
              // (small pulsing dots are "live" lights, not placeholders)
              const now = await evaluate(`document.body ? document.body.innerText.length + ":" + [...document.querySelectorAll('[data-slot="skeleton"],.animate-pulse,[aria-busy="true"]')].filter((e) => e.offsetWidth > 24 && e.offsetHeight > 10).length + ":" + [...document.images].filter((i) => !i.complete).length : ""`).catch(() => "");
              const busy = now.split(":").slice(1).some((n) => +n > 0) && i < 45;
              same = now && now === last && !busy ? same + 1 : 0;
              last = now;
              await sleep(300);
            }
            await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true").catch(() => null);
          },
          close: () => send("Target.closeTarget", { targetId }),
        };
      },
      close: () => send("Target.disposeBrowserContext", { browserContextId }),
    };
  }

  return {
    context,
    async close() {
      try { await send("Browser.close"); } catch { /* already gone */ }
      await new Promise((ok) => { child.once("exit", ok); setTimeout(ok, 4000); });
      child.kill();
      // Chrome may still be writing its last files: the throw-away profile is removed when it lets go
      for (let i = 0; i < 5; i++) { try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(400); } }
    },
  };
}
