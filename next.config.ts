import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets a route change be a view transition, which is what carries a poster
    // from its tile in the library across to the page it opens. React's
    // <ViewTransition> does the pairing; this flag is what makes navigation
    // trigger it. See app/art.tsx and the morph rules in app/globals.css.
    viewTransition: true,
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
