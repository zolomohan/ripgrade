"use client";

import { useSearchParams } from "next/navigation";

import { Switch } from "@/app/controls";

/**
 * Which settings you are looking at, and a line saying what they are for.
 *
 * Four groups, on one line, all four visible. This has been a segmented
 * switch, then a dropdown, then four headings down a single column, and the
 * dropdown and the column were both worse than what they replaced: a menu
 * makes you open a control to find out what the choices are, and one long
 * column makes the page's length the thing you navigate. A row of four words
 * is the shortest true statement of what this page contains.
 *
 * The blurb under the title changes with the group, which is what makes the
 * head worth having at all — "Settings" alone is a word the rail already said.
 *
 * The panels are rendered by the server page and handed over as nodes; this
 * only decides which set is on screen. In the URL under `t`, like every other
 * tab in this app, so a link can point at a group and coming back from a
 * folder picker returns to the one you were on.
 */
export function SettingsTabs({
  groups,
}: {
  groups: readonly {
    key: string;
    label: string;
    /** What this group is for, under the page's own name. */
    blurb: string;
    settings: React.ReactNode;
  }[];
}) {
  const searchParams = useSearchParams();

  const param = searchParams.get("t");
  const known = groups.some((group) => group.key === param);
  const tab = known ? (param as string) : groups[0].key;

  function select(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    // The first group is the page unasked, so it says so by leaving the
    // parameter out rather than by naming itself in the address bar.
    if (next === groups[0].key) params.delete("t");
    else params.set("t", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  const current = groups.find((group) => group.key === tab) ?? groups[0];

  return (
    <>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="text-sm opacity-55">{current.blurb}</p>
        </div>

        {/* The scroll container takes the `-ml-2` rather than the switch,
            which is the one place it cannot go — a child hanging off the left
            edge of something that scrolls is clipped with no way to scroll
            back to it. */}
        <div className="no-scrollbar -mr-1 -ml-2 flex min-w-0 max-w-full overflow-x-auto px-1">
          <Switch
            value={tab}
            onChange={select}
            // No counts. A settings group holds however many it holds, and a
            // number over a word is one nobody came here to read.
            options={groups.map(({ key, label }) => ({ key, label }))}
          />
        </div>
      </div>

      {/* 2rem under the switch, which is what every head on every page in this
          app stands above what it heads. The first row draws the hairline that
          parts it from the control above, so the group reads as a list from
          its first line rather than from its second. */}
      <div className="mt-8">{current.settings}</div>
    </>
  );
}
