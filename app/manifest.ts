import type { MetadataRoute } from "next";

/**
 * What a browser reads to install this as an app rather than keep it as a tab.
 *
 * Safari's *Add to Dock* on macOS, and Chrome's install button, both take the
 * name, the icon and the window shape from here. `standalone` is the point of
 * the exercise: the app opens in its own window with no address bar, which it
 * can afford because every route is reachable from the rail in `app/sidebar.tsx`
 * — there is nowhere the browser's back button is the only way out.
 *
 * The icons are generated from the two marks already in the repo: `app/icon.svg`
 * for the rounded tile, and `public/skull.svg` composited onto a full-bleed
 * square for the maskable one, where the launcher supplies the shape and
 * anything in the outer 20% may be cropped away.
 *
 * No `scope`: it defaults to the directory of `start_url`, which is the whole
 * app, and this is served from the root of its own origin.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RipGrade",
    short_name: "RipGrade",
    description: "Audit the technical quality of a local film library",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    // The dark end of the palette in `globals.css`, both of them, because these
    // are what the window is painted with before the app has rendered a frame —
    // and the app is dark far more often than not.
    background_color: "#0b0b0d",
    theme_color: "#0b0b0d",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // The pages worth a right-click on the dock icon. Deliberately short: the
    // three the app is opened *for*, not a copy of the rail.
    //
    // Jobs in place of Downloads, which is not a page any more: what is being
    // fetched is on the queue with the things to fetch, and the third reason to
    // open this app is the work it is doing to the files you already have.
    shortcuts: [
      { name: "Library", url: "/library" },
      { name: "Queue", url: "/upgrades" },
      { name: "Jobs", url: "/jobs" },
    ],
  };
}
