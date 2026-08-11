"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`, which is what makes the browser treat this as an
 * installable app and what puts an honest page in the window when the server
 * cannot be reached.
 *
 * Guarded, because a service worker is only available on a secure origin, and
 * this app is very often not on one: `localhost` counts as secure, but the same
 * app opened at `http://nas.local:6969` from another machine does not. That is
 * a supported way to run RipGrade, so registration failing there is expected
 * rather than broken — the manifest still installs, and Safari's Add to Dock
 * never wanted this file in the first place.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Deferred past load: registration competes with the app's first requests
    // for the connection otherwise, and nothing on screen is waiting for it.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
