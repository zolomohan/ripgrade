"use client";

import { useTransition } from "react";

import { Switch } from "@/app/controls";
import type { Layout } from "@/lib/layout";
import { setListLayout } from "../actions";

/**
 * Posters or rows, for every list in the app that draws both.
 *
 * This was a button in three control bars — the downloads log's, the jobs
 * page's, the wishlist's finds — reading `?v=` out of whichever address you
 * happened to be at. Which made it a question each of those pages asked
 * separately and forgot separately: set the wishlist to rows and the jobs page
 * still opened as posters, and neither remembered the answer once the URL was
 * gone.
 *
 * It is one answer here because it was always one answer. A sort key is a fact
 * about a particular list; how you would rather read a list is a fact about
 * you, and a preference asked once per page is a preference nobody sets.
 *
 * A switch rather than the toggle the rest of this page uses: those are on and
 * off, and this is two named states of which neither is the absence of the
 * other. The same control the tabs above it are drawn with, which is what the
 * app already spends on a choice between two words.
 */
export function ListLayout({ layout }: { layout: Layout }) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      // Pending rather than disabled: a `Switch` has no disabled state and a
      // dead control would be the wrong answer anyway — the write is one row
      // and the page it redraws is this one. Dimmed while it is in flight, so
      // a second press before the first has landed at least looks like one.
      className={pending ? "opacity-60 transition-opacity" : undefined}
    >
      <Switch
        value={layout}
        onChange={(next) =>
          startTransition(async () => setListLayout(next as Layout))
        }
        options={[
          { key: "grid", label: "Posters" },
          { key: "rows", label: "Rows" },
        ]}
      />
    </div>
  );
}
