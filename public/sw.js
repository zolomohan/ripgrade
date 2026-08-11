/*
 * The service worker, kept as small as a service worker can honestly be.
 *
 * RipGrade is a window onto a server that is reading discs, running ffmpeg and
 * talking to a torrent client — there is no page here whose cached copy would
 * still be true a minute later. So nothing of the app is cached. What this does
 * is answer the one question caching is genuinely needed for: what the window
 * shows when the machine hosting it is asleep, off, or on the other side of a
 * dropped Wi-Fi connection. Installed to the dock, that is a blank window and a
 * browser error page for an address bar that is no longer there.
 *
 * It also satisfies the install criteria Chromium applies before it will offer
 * the app as an app. Safari's Add to Dock does not need this file at all.
 */

// Bump when offline.html changes: the install step is the only thing that
// writes to this cache, and a new name is what makes it run again.
const SHELL = "ripgrade-shell-v2";
const OFFLINE = "/offline.html";
const OFFLINE_ICON = "/icon-512.png";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // The icon too, because the offline page shows it and the network it
      // would fetch it from is the network that is gone.
      .then((cache) => cache.addAll([OFFLINE, OFFLINE_ICON]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Page loads, and the one image the page they fall back to is made of.
  // Everything else — assets, server actions, the job streams — is left to the
  // browser entirely: an intercepted fetch that adds nothing is still a hop
  // through this worker on every request the app makes.
  const wanted =
    event.request.mode === "navigate"
      ? OFFLINE
      : url.origin === self.location.origin && url.pathname === OFFLINE_ICON
        ? OFFLINE_ICON
        : null;
  if (!wanted) return;

  // Network first and network only; the fallback is reached when fetch
  // *rejects*, which is the server being unreachable rather than the server
  // saying something went wrong. An error page from the app is the app.
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(wanted, { cacheName: SHELL }),
    ),
  );
});
