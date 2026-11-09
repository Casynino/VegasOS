// The staff app's service worker. It only passes every request straight through to the network: nothing is stored, nothing is answered
// from a copy, so what staff see is always the live system. Its one job is to make the browser treat the staff app as installable:
// Chrome and Samsung Internet on Android offer the one-tap "Install app" only for a site that has a service worker with a fetch handler.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
