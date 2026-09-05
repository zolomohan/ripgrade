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
 * a couple of these directly. `Explained` is the exception and is imported as
 * what it is — a client component rendered by server ones, which is the one
 * direction that crossing works in.
 */

import { Explained } from "../controls";
import { stagger } from "../stagger";

/**
 * The one action a section exists for. The film page's Upgrade button.
 *
 * A pill, like every other button in the app now — and `inline-flex` with a
 * gap, so the ones that go and ask a server something can put a `Spinner`
 * beside their label while they wait.
 */
export const PRIMARY =
  "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition-opacity duration-150 hover:opacity-90 disabled:opacity-40";

/** Everything else you can do here — present, but never the loudest thing. */
export const QUIET =
  "inline-flex shrink-0 items-center gap-1.5 text-xs opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30";

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

/**
 * A labelled input. The label is the app's own micro-heading, not a sentence.
 *
 * Arrives the way every other list in this app arrives — see `.row-enter` and
 * `stagger`. A dialog's fields are a list; they were the one list here that
 * simply appeared, fully formed, while the rows under a download's destination
 * picker two dialogs away cascaded in. The pace and the cap are the shared
 * ones, so a form reads at the speed the rest of the app does, and
 * `prefers-reduced-motion` turns it off in the same place as everything else.
 */
export function Field({
  label,
  hint,
  index = 0,
  children,
}: {
  label: string;
  hint?: string;
  /** Its place in the form's cascade, as a list row carries its own. */
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <label style={stagger(index)} className="row-enter flex flex-col gap-1.5">
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
    <p
      role="alert"
      className="font-mono text-xs text-red-600 dark:text-red-400"
    >
      {children}
    </p>
  );
}

/**
 * One setting: what it is and why, on the left; the control, on the right.
 *
 * The shape every settings screen worth using has, and the one this page kept
 * not having. It was nine panels in a column, then three tabs of panels, then
 * a menu of them, then four headings above them — four goes at the same
 * question, and every one of them answered "how do I find a setting" while
 * leaving the setting itself as a drawer with a word on it. A drawer is the
 * wrong container for a control. It hides what the control is set to behind
 * the one thing you have to do to find out, and a page of fourteen of them is
 * a page with nothing on it.
 *
 * So the setting is open, always, and it is two columns. On the left its name
 * and a line saying what it does, which is what makes a page of these
 * skimmable — the eye runs down the names and stops at the one it wants. On
 * the right the control, at the right-hand edge where the eye goes back to
 * when it has found its row. Between them a hairline, which is the whole of
 * the separation and the reason the eye can tell one row from the next.
 *
 * The long argument for a setting is still there and is still a tooltip: these
 * run to four hundred characters and belong to whoever wants them, not to
 * everyone scrolling past. `blurb` is the line that is always on, and it is
 * one line by construction — see the copy on the page itself.
 */
export function SettingRow({
  title,
  blurb,
  hint,
  children,
}: {
  title: string;
  /** The line that is always shown. One sentence, no more. */
  blurb: string;
  /** The long form, behind the dotted underline on the title. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid gap-x-8 gap-y-3 border-t border-line py-5 sm:grid-cols-[minmax(0,7fr)_minmax(0,9fr)] sm:items-center"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {hint ? <Explained hint={hint}>{title}</Explained> : title}
        </p>
        <p className="mt-1 text-xs leading-relaxed opacity-50">{blurb}</p>
      </div>

      {/* The controls keep their own arrangement — most are a reading of the
          current state and a button, laid out exactly this way already — and
          only have to sit inside a column that ends where the page does. */}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A row within a setting: what it is on the left, the control on the right.
 *
 * Parted from what precedes it by a hairline rather than by a border round
 * itself — the same join every list in this app makes. The rule runs the width
 * of the column and no further: it belongs to the setting above it, not to the
 * page.
 *
 * One line, where it used to be two. The second was the hint, set small and
 * faint under the title, and a panel of four rows was four titles competing
 * with four explanations of them — which is the argument the settings made
 * against their own paragraphs, at a smaller size. It is on the title now.
 */
export function Row({
  title,
  hint,
  children,
}: {
  title: string;
  /** On the title, the way a setting's own is — see `Panel` in app/panel.tsx. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {hint ? <Explained hint={hint}>{title}</Explained> : title}
        </p>
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
