/**
 * The heading a page's sections are parted by: a name, and the hairline the
 * rest of the app rules its headings with.
 *
 * Written for the downloads log — "Downloading", then "History" — and pulled
 * out of it the moment a second page wanted the same two-part shape. A section
 * heading is a thing this app has an opinion about, and two copies of that
 * opinion is one more than it can hold.
 */
export function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {label}
      </h2>
      <div aria-hidden className="rule-head" />
    </div>
  );
}
