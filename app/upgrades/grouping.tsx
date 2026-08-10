"use client";

/**
 * Grouping, in the shape the library shelf already uses.
 *
 * A sort answers "which of these first"; a group answers "which of these are
 * the same kind of thing" — and on a queue that is often the more useful
 * question. A hundred and eight episode rows are eight shows; a cleanup list is
 * two kinds of decision wearing the same row. Neither is visible in any order
 * you can put a flat list into.
 *
 * The same declaration the library's `GROUPS` uses — a key, a label, and what
 * bucket an item falls in — so the two behave alike and the menu is the same
 * menu. Every list here keeps "No grouping" as its first option: these are
 * ranked lists first, and a ranking cut into sections is no longer one.
 */
export type GroupOption<T> = {
  key: string;
  label: string;
  /** Which bucket an item belongs in. "" for the no-grouping option. */
  of: (item: T) => string;
  /** Fixed order for the buckets; anything unlisted trails it alphabetically. */
  order?: string[];
};

export const pickGroup = <O extends { key: string }>(
  options: O[],
  key?: string,
): O => options.find((option) => option.key === key) ?? options[0];

/**
 * The buckets, in the group's declared order.
 *
 * Insertion order within a bucket is the sort's order, untouched: grouping
 * cuts a ranked list into sections, it does not re-rank it.
 */
function bucketsOf<T>(items: T[], group: GroupOption<T>): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const name = group.of(item);
    const bucket = map.get(name);
    if (bucket) bucket.push(item);
    else map.set(name, [item]);
  }

  const order = group.order ?? [];
  return [...map.entries()].sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    // Anything the group did not name sorts after everything it did, so a
    // bucket nobody anticipated never silently takes the top of the page.
    if (ia !== -1 || ib !== -1)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b, "en-GB");
  });
}

/** A shelf-style section head: the name, what is under it, and a rule. */
export function SectionHead({
  label,
  note,
}: {
  label: string;
  /** The count and total for this section, when it has one worth saying. */
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {label}
        </h2>
        {note && <p className="text-[11px] opacity-40">{note}</p>}
      </div>
      <div aria-hidden className="rule-head" />
    </div>
  );
}

/**
 * Renders a list either flat or cut into sections.
 *
 * The list itself is the caller's — every tab draws its own rows — so this
 * hands back each bucket along with how many rows came before it, which is
 * what keeps the entrance stagger running down the page rather than restarting
 * at every heading.
 */
export function Grouped<T>({
  items,
  group,
  note,
  children,
}: {
  items: T[];
  group: GroupOption<T>;
  note?: (items: T[]) => string;
  children: (items: T[], offset: number) => React.ReactNode;
}) {
  if (group.key === "none") return <>{children(items, 0)}</>;

  const buckets = bucketsOf(items, group);
  // How many rows precede each section, worked out up front rather than
  // accumulated through the map: a counter mutated while rendering is a
  // counter that keeps counting on the next render.
  const before = buckets.map((_, i) =>
    buckets.slice(0, i).reduce((n, [, bucket]) => n + bucket.length, 0),
  );

  return (
    // Further apart than rows in a list are, so a heading reads as belonging to
    // what follows it rather than to the section it just ended.
    <div className="flex flex-col gap-6">
      {buckets.map(([name, bucket], i) => (
        <section key={name} className="flex flex-col gap-1">
          <SectionHead label={name} note={note?.(bucket)} />
          {children(bucket, before[i])}
        </section>
      ))}
    </div>
  );
}
