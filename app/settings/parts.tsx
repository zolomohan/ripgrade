/**
 * The pieces every setting is built from.
 *
 * Settings used to be cards: a bordered box per setting, another box for the
 * form inside it, and a third for the list inside that. Boxes are how a page
 * says "these things are separate", and the rest of this app says it with a
 * hairline and a heading instead — so a page of frames read as somebody else's
 * app bolted on beside this one.
 *
 * What is here is the app's own vocabulary, said once: a state as a dot and a
 * word, a machine string in mono, a field under a small tracked label, one
 * filled button for the thing you came to do and quiet text for everything
 * else. Nothing draws a border of its own. The panel around them is the frame.
 *
 * No hooks and no "use client": the page is a server component and reaches for
 * a couple of these directly.
 */

/** The one action a section exists for. The film page's Upgrade button. */
export const PRIMARY =
  "h-8 shrink-0 rounded-chip bg-foreground px-3.5 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-40";

/** Everything else you can do here — present, but never the loudest thing. */
export const QUIET =
  "shrink-0 text-xs opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30";

/** Undoing something, which is quiet too but says so in red at the last step. */
export const DANGER =
  "shrink-0 rounded-control border border-red-500/40 bg-red-500/[0.08] px-2.5 py-1 text-xs text-red-700 transition-opacity hover:opacity-80 disabled:opacity-40 dark:text-red-300";

/** Addresses, keys and paths — machine text, so a machine face. */
export const FIELD =
  "w-full rounded-control border border-line bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-line-strong";

/**
 * Whether a thing is on, as a dot and a word.
 *
 * The dot rather than a coloured sentence: the pages this app is made of say
 * their verdicts in colour and their facts in text, and "connected" is a fact
 * about a service that happens to be worth spotting from across the page.
 */
export function Status({
  on,
  label,
  detail,
}: {
  on: boolean;
  label: string;
  /** The address or path behind it, where there is one. */
  detail?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          on ? "bg-emerald-500" : "bg-foreground/25"
        }`}
      />
      <div className="min-w-0">
        <p className="truncate text-sm">{label}</p>
        {detail && (
          <p className="truncate font-mono text-[11px] opacity-45">{detail}</p>
        )}
      </div>
    </div>
  );
}

/** A labelled input. The label is the app's own micro-heading, not a sentence. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold tracking-[0.12em] uppercase opacity-40">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] opacity-45">{hint}</span>}
    </label>
  );
}

/** The quiet line under a control that says what will happen, or just did. */
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] opacity-45">{children}</p>;
}

/**
 * What went wrong, in the machine's own words.
 *
 * `role="alert"` because these appear after a click rather than with the page:
 * a line that materialises silently is read by whoever happened to be looking
 * at that corner. Used well beyond Settings now — anywhere an action can come
 * back with a reason it did not happen.
 */
export function Failure({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="font-mono text-xs text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

/**
 * A row within a setting: what it is on the left, the control on the right.
 *
 * Parted from what precedes it by a hairline rather than by a border round
 * itself — the same join every list in this app makes. The rule runs the width
 * of the column and no further: it belongs to the setting above it, not to the
 * page.
 */
export function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{title}</p>
        {hint && <p className="mt-0.5 max-w-prose text-xs opacity-45">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** The switch, which two settings had a copy of each. */
export function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        on
          ? "bg-foreground"
          : "bg-surface-strong ring-1 ring-line-strong ring-inset"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full transition-[left] duration-200 ${
          on ? "left-5 bg-background" : "left-1 bg-foreground/40"
        }`}
      />
    </button>
  );
}
