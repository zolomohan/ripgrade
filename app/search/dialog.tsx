"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { Modal } from "@/app/modal";
import { SearchView } from "./search-view";

/**
 * Search, over whatever you are already looking at.
 *
 * It was a page in the rail, which meant that looking something up cost a
 * navigation each way: leave the film you were reading, type, and then find
 * your way back to it. But a search is rarely the thing you are doing — it is
 * the thing you do in the middle of doing something else, and the answer is
 * usually one glance ("do I already have this?") rather than a shelf you settle
 * into. So it opens over the page and closes off it, and the page is still
 * there underneath, scrolled where you left it.
 *
 * ⌘F, because that is the key every browser and every editor has already taught
 * for "find" — and the browser's own find, over a page of posters, is looking
 * for words that are not there. The rail keeps a button on it as well, since a
 * key nobody has been told about is a key nobody presses.
 *
 * There is no page behind this any more: /search is gone, and this folder holds
 * no `page.tsx` because nothing here is a route. What it cost is the address —
 * a search used to be somewhere you could link to and come back to — and what
 * it bought is that you never leave what you were reading to run one.
 */

/** Opening it is the only thing anyone outside needs. */
const OpenSearch = createContext<() => void>(() => {});

export const useSearchDialog = () => useContext(OpenSearch);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);

  /*
   * Which page it was opened over — not a flag, because being open is a fact
   * about a page rather than about the app: a result was clicked, the address
   * changed, and the window is now hanging over somewhere nobody asked to see
   * it through. Reading the two together closes it on every way out at once —
   * a poster, a show, the Settings link in a message about TMDb — without each
   * of them having to be handed something to call.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  const show = useCallback(() => setOpenedOn(pathname), [pathname]);
  const close = useCallback(() => setOpenedOn(null), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f")
        return;

      // Always: the browser's find is not the one wanted on any page of this
      // app, and a key that works everywhere except where you happen to be
      // focused is a key you stop trusting.
      event.preventDefault();

      /*
       * Pressed again while it is up, it puts you back in the field with the
       * last search selected — the same thing ⌘F does in a browser, and the
       * gesture for "no, something else" when the answer on screen was not it.
       */
      if (open) {
        const field = panel.current?.querySelector("input");
        field?.select();
        return;
      }

      show();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, show]);

  return (
    <OpenSearch.Provider value={show}>
      {children}

      <Modal
        open={open}
        onClose={close}
        label="Search"
        /*
         * Held near the top rather than centred, and one height whatever is in
         * it: a box sized to its contents is a box that jumps on every
         * keystroke — twelve tiles taller than the empty state, three results
         * shorter than twelve, and the field riding up and down with it. The
         * window is a window. What arrives inside it scrolls.
         *
         * Stated in the viewport's own units so a short screen gets a short
         * one, capped so a tall screen does not get a column of poster you
         * have to stand up to read.
         */
        /*
         * `rounded-panel` rather than the card's radius every other dialog
         * takes: this is the one whose contents start with a pill, an inch from
         * the corner, and the two curves have to agree. See `--radius-panel` in
         * globals.css for the arithmetic.
         */
        panelClassName="mt-[6vh] flex h-[min(78vh,46rem)] w-full max-w-4xl flex-col self-start overflow-hidden glass-panel rounded-panel border border-line p-4 shadow-2xl"
      >
        <div ref={panel} className="flex min-h-0 flex-1 flex-col">
          <SearchView />
        </div>
      </Modal>
    </OpenSearch.Provider>
  );
}
