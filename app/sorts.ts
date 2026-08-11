/**
 * How a tabbed list is ordered, and the shape every one of them declares it in.
 *
 * At the app's root rather than beside one page's tabs, because the lists that
 * declare these are on two pages now: the queue ranks what there is to fetch,
 * and the jobs page ranks the work the library can do to its own files.
 *
 * Each list owns its own options, because what "best first" means is different
 * in each: a gain against your copy, a file about to be rewritten, the space a
 * removal frees, the space a deletion frees. What they share is the control
 * that picks between them — so the options travel as data, labels for the menu
 * and a comparator for the list, and the switch above them needs to know
 * nothing about which list is showing.
 */
export type SortOption<T> = {
  key: string;
  label: string;
  compare: (a: T, b: T) => number;
};

/**
 * The chosen option, or the list's own default.
 *
 * Every list defines its default first, so an unknown key — a stale URL, a tab
 * switched under a sort that meant something on the last one — falls back to
 * the order the list was designed to be read in rather than to nothing.
 */
export const pickSort = <O extends { key: string }>(
  options: O[],
  key?: string,
): O => options.find((option) => option.key === key) ?? options[0];

/** One way of comparing titles, so A–Z means the same on every tab. */
export const byTitle = (a: string, b: string) => a.localeCompare(b, "en-GB");
