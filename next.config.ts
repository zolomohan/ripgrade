import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets a route change be a view transition, which is what carries a poster
    // from its tile in the library across to the page it opens. React's
    // <ViewTransition> does the pairing; this flag is what makes navigation
    // trigger it. See app/art.tsx and the morph rules in app/globals.css.
    viewTransition: true,
    serverActions: {
      // Artwork you upload travels as a server action, and one of those carries
      // 1MB by default — under a single 4K backdrop, so the feature would fail
      // on almost every file worth uploading. This is `MAX_UPLOAD_BYTES` in
      // lib/artwork.ts plus room for the multipart framing around it, so the
      // file that gets refused is refused by the app, with a sentence saying
      // how big it was, rather than by the body parser with nothing.
      bodySizeLimit: "34mb",
    },
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
