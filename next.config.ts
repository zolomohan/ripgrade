import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /*
     * Turbopack's compilation cache, kept in memory rather than on disk.
     *
     * On by default in dev — and off by default for a build, which is the hint.
     * It is an incremental bundler's working state written down: every module
     * compiled, every dependency edge, every intermediate result, in a
     * log-structured store under `.next/dev/cache` so that a restart can skip
     * work it has already done.
     *
     * Appending is the part it is good at. Reclaiming is the part it is not:
     * this store reached a hundred gigabytes — 2,594 tables, growing since
     * August — which is a tenth of the disk, and the dev server maps the whole
     * thing at startup. That is where seven gigabytes of a freshly started
     * server came from, before it had served a single request, and why each
     * flush took longer than the one before it: thirty seconds to write into a
     * store that never got smaller.
     *
     * What turning it off costs is the first compile of each route after a
     * restart, which is seconds. What it buys is a dev server that starts at
     * its own size. Recompiles while the server runs are untouched — that
     * incrementality is in memory and is not this.
     */
    turbopackFileSystemCacheForDev: false,

    /*
     * How long the client keeps a page it has already been given.
     *
     * Stated rather than inherited, because the default moved under this app
     * once already: `dynamic` was thirty seconds until Next 15 and is zero
     * now, and zero means a page is thrown away the moment you leave it. Every
     * route here is dynamic, so nothing was ever kept and every visit to a tab
     * was a fresh fetch of the whole thing.
     *
     * `static` is the number that actually applies to the rail, since its
     * links prefetch in full — see `prefetch` in app/sidebar.tsx — and five
     * minutes of a library that changes only when a scan writes to it is not a
     * gamble. `dynamic` is raised off the floor for everything else: the film
     * pages, opened from a shelf and stepped back out of, where thirty seconds
     * covers the way you actually move through them.
     *
     * Neither number is load-bearing for freshness. The server actions call
     * `refresh()` after a write and the scan's end does the same through the
     * job stream, so a change on disk clears these rather than waiting them
     * out.
     */
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
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
