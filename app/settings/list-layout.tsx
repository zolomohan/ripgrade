"use client";

import { useTransition } from "react";

import { Choice } from "../controls";
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
 * A menu rather than the toggle the rest of this page uses: those are on and
 * off, and this is two named states of which neither is the absence of the
 * other. See `Choice` in ./parts.tsx for why it is not the switch it was.
 */
export function ListLayout({ layout }: { layout: Layout }) {
  const [pending, startTransition] = useTransition();

  return (
    <Choice<Layout>
      value={layout}
      label="List layout"
      // Dimmed rather than dead while the write is in flight: it is one row
      // and a repaint of the page it is standing on, and a control that went
      // grey for that would flicker on every press.
      disabled={pending}
      options={[
        { value: "grid", label: "Posters" },
        { value: "rows", label: "Rows" },
      ]}
      onChange={(next) => startTransition(async () => setListLayout(next))}
    />
  );
}
