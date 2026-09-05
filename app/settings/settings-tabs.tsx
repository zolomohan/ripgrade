"use client";

import { useSearchParams } from "next/navigation";

import { ICONS, MenuItem, Popover } from "@/app/controls";

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
 *
 * A menu rather than a segmented switch. The switch put every group on screen
 * at once, which is the argument for one — and the argument against it here is
 * what that costs: a row of words as wide as the longest three of them, sitting
 * above a page whose whole content is one of the three. It also had to scroll
 * sideways on a narrow window, which is a control the page can hide part of.
 * A menu is the width of the group you are in, says which that is, and the
 * other two are one press away rather than zero — the right trade for a
 * page you come to having already decided what you are changing.
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
      {/* 2rem below it, which is what every head on every page in this app
          stands above what it heads. This was 5, the listing bar was 8 on top
          of a column gap, and the shelves were 6: three answers to the same
          question, one per page somebody happened to be looking at. */}
      <div className="mb-8 flex">
        <Popover
          icon={ICONS.filter}
          label="Showing"
          // The group you are in, on the trigger — a menu that named only
          // itself would make you open it to find out where you were.
          value={current.label}
          // The chevron, for the reason `Popover` gives: the value here is a
          // word, and a word beside an icon reads as a label on a field until
          // something says it can be changed.
          caret
          align="left"
          width="w-56"
          buttonClassName="rounded-full"
        >
          {(close) => (
            <div className="py-1">
              {groups.map((group) => (
                <MenuItem
                  key={group.key}
                  active={group.key === current.key}
                  onClick={() => {
                    select(group.key);
                    close();
                  }}
                >
                  {group.label}
                </MenuItem>
              ))}
            </div>
          )}
        </Popover>
      </div>

      {current.settings}
    </>
  );
}
