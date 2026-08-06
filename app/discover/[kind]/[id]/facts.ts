/**
 * The small formatting shared by the four pages under this route and by the
 * lists inside them. No "use client" and nothing server-only, because both
 * sides render these strings.
 */

/** "2h 14m", "45m" — the way a running time is said out loud. */
export const runtime = (minutes?: number) => {
  if (!minutes) return undefined;
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

/** The same date format the show page uses for an episode's air date. */
export const airDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : undefined;

/** S01E03, and S01 on its own for a season. */
export const numbering = (season: number, episode?: number) =>
  `S${String(season).padStart(2, "0")}${
    episode === undefined ? "" : `E${String(episode).padStart(2, "0")}`
  }`;

/** How many episodes, said as a phrase rather than a bare figure. */
export const episodeCount = (count: number) =>
  `${count} ${count === 1 ? "episode" : "episodes"}`;
