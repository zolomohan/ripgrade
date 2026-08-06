/**
 * A scan on every start.
 *
 * The library is a picture of a drive, and the drive changes while the app is
 * not running — films land in it, get renamed, get deleted. Asking someone to
 * press a button to correct that made the freshness of the whole app a chore
 * they had to remember; now booting it is what refreshes it, and the button is
 * in Settings for the times you have just moved a file and do not want to wait.
 *
 * `register` runs once per server instance and holds up readiness until it
 * returns, so this only *starts* the scan — `startScan` returns the moment the
 * job is running, and the rail follows it from there.
 */
export async function register() {
  // Node only: nothing here can run at the edge, and there is no drive there
  // to walk. And not during a build — `next build` spins up its own workers,
  // and a build is not the app starting.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Imported here rather than at the top of the file: these reach the database
  // and the filesystem, which the edge bundle must never pull in.
  const { getLibraryRoots } = await import("@/lib/roots");
  const { startScan } = await import("@/lib/scanner");

  try {
    const roots = getLibraryRoots();
    // No folder chosen yet — Settings is where that starts, and a scan of
    // nothing would only report an error nobody asked for.
    if (roots.length === 0) return;

    startScan(roots);
  } catch (err) {
    // A failed scan is reported in the app; a failed *start* must not be the
    // reason the app does not come up at all.
    console.error("Start-up scan could not begin:", err);
  }
}
