// The Vegas Hotel staff app's service worker (copied from Super Drive's). It stores NOTHING on the phone (no pages, no business data) and
// changes no request except one thing: when a PAGE cannot load because the phone has no signal, it shows a short "No internet" page
// instead of the browser's error. Pictures, data and form posts go straight to the network, untouched.
// Its other job is to make the app installable on every phone browser: Chrome only offers its one-tap Install button to a site with a
// service worker that handles page loads.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0c0a07"><meta name="color-scheme" content="dark"><title>No internet</title>
<style>html,body{margin:0;height:100%;background:#0c0a07;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}
h1{margin:0;font-size:20px;font-weight:600}p{margin:0;max-width:20rem;color:rgba(255,255,255,.7);font-size:15px;line-height:1.45}
button{margin-top:6px;height:44px;padding:0 26px;border:0;border-radius:999px;background:#e2ba6e;color:#1a1408;font-size:15px;font-weight:600}</style></head>
<body><main><h1 id="h">No internet</h1><p id="p">Vegas Hotel needs a connection. Nothing you did is lost. Check your signal or Wi-Fi, then try again.</p><button id="b" onclick="location.reload()">Try again</button></main>
<script>if(/^zh/i.test(navigator.language)){document.title=document.getElementById("h").textContent="没有网络";document.getElementById("p").textContent="Vegas Hotel 需要网络连接。你做的操作不会丢失。请检查信号或 Wi-Fi，然后重试。";document.getElementById("b").textContent="重试";document.documentElement.lang="zh-CN"}</script></body></html>`;

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // pictures, data and form posts go straight to the network, untouched
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } })),
  );
});
