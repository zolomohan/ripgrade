"use client";

import { useSearchParams } from "next/navigation";

import { Switch } from "@/app/controls";

/**
 * Which settings you are looking at.
 *
 * Nine panels in one column meant the folders you scan and the client you hand
 * a magnet to were the same list, a scroll apart, and the only thing telling
 * you which half you were in was how far down the bar had gone. Shut panels
 * made that column short enough to fit — they did not make it one subject.
 *
 * So the settings are cut the way the app itself is cut: what the library is
 * made of, what the app does to those files, and where new files come from.
 * Each tab is a handful of panels about one thing, and the page arrives on the
 * first — the folders, without which nothing else here has anything to act on.
 *
 * The panels are rendered by the server page and handed over as nodes; this
 * only decides which set is on screen. In the URL under `t`, like every other
 * tab in this app, so a link can point at a tab and coming back from a folder
 * picker returns to the one you were on.
 */
export function SettingsTabs({
  groups,
}: {
  groups: readonly { key: string; label: string; settings: React.ReactNode }[];
}) {
  const searchParams = useSearchParams();

  const param = searchParams.get("t");
  const known = groups.some((group) => group.key === param);
  const tab = known ? (param as string) : groups[0].key;

  function select(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    // The first tab is the page unasked, so it says so by leaving the
    // parameter out rather than by naming itself in the address bar.
    if (next === groups[0].key) params.delete("t");
    else params.set("t", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  const current = groups.find((group) => group.key === tab) ?? groups[0];

  return (
    <>
      {/* Its own space below it, like the listing bar over every other tabbed
          page here: a panel that began one gap under the switch would read as
          a fourth segment of it.

          The scroll container takes the `-ml-2` rather than the switch, which
          is the one place it cannot go — a child hanging off the left edge of
          something that scrolls is clipped with no way to scroll back to it. */}
      <div className="no-scrollbar mb-5 -mr-1 -ml-2 flex min-w-0 max-w-full overflow-x-auto px-1">
        <Switch
          value={tab}
          onChange={select}
          // No counts. A settings tab holds however many panels it holds, and
          // "3" over a word is a number nobody came here to read.
          options={groups.map(({ key, label }) => ({ key, label }))}
        />
      </div>

      {current.settings}
    </>
  );
}
