import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets a route change be a view transition, which is what carries a poster
    // from its tile in the library across to the page it opens. React's
    // <ViewTransition> does the pairing; this flag is what makes navigation
    // trigger it. See app/art.tsx and the morph rules in app/globals.css.
    viewTransition: true,
  },
  async headers() {
    return [
      {
        // The service worker must never be served from cache: it is the file
        // that decides how everything else is fetched, so a stale copy is a
        // stale copy of the rules. Browsers already refuse to cache it for
        // long, and `updateViaCache: "none"` at registration says the same —
        // this is the third and last place that can get it wrong.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // The old address for every file's page. Bookmarks and history predate
      // the film/episode split; /film sorts an episode id onward itself.
      { source: "/movie/:id", destination: "/film/:id", permanent: false },
    ];
  },
};

export default nextConfig;
