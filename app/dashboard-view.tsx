"use client";

import Link from "next/link";

import { Art } from "./art";
import { Bars, Card, Coverage, Stat } from "./charts";
import { count, size } from "./format";
import { useEntrance } from "./return-to";
import { stagger } from "./stagger";
import type { Dashboard } from "@/lib/dashboard";
import { posterName } from "@/lib/routes";

/**
 * What to do about the library, on one page.
 *
 * The rule that decides what is here and what is on `/stats`: if a panel has no
 * verb and no clock, it belongs there. The census — how many films are 2160p,
 * what the decades look like, which collections are biggest — is timeless and
 * complete and answers "what do I have". Everything on this page is either a
 * quantity of outstanding work with somewhere to go, or a state of the machine
 * that can be wrong right now.
 *
 * That rule is load-bearing rather than decorative. Without it a dashboard
 * becomes a second stats page with a worse layout, because every census fact is
 * individually interesting and none of them tell you to do anything. It is also
 * what emptied this page out: the download log, the growth chart, the
 * housekeeping list and two coverage bars all went, because a panel that reads
 * the same on every visit is one you have already stopped seeing.
 *
 * Ruled apart rather than boxed, like every list in this app. Colour is spent
 * twice and no more: red on a critical count, and red on a service or a drive
 * that is not answering. Everything else is one ink — a bar's length already
 * says which is bigger, and a thing that is working needs no hue to say so.
 *
 * One measure of space between anything with a heading on it: `gap-12`, whether
 * the join is card to card or heading to the figures under it. The page had
 * four distances at one point — margins added to the column's own gap in two
 * places, a tighter gap inside the bands, a wider one inside the figure rows —
 * and four distances is none, because no two of them meant anything to each
 * other. `gap-8` survives in exactly one place, between the figures of a single
 * row, where it is setting columns rather than separating parts.
 *
 * Drawn on the client although it holds no state, because the charts do: a
 * figure counts itself up and a bar grows into place, which is behaviour, and
 * `format={size}` is a function — the one kind of prop that cannot cross the
 * boundary. `app/page.tsx` stays on the server and does the reading; this draws
 * what it was handed. Nothing extra is sent for the privilege, since the whole
 * `Dashboard` object was already going over as props.
 */

/**
 * A severity's colour, as the rest of the app already spends it.
 *
 * The same three tones `/how-it-works` and the film page use: red is the one
 * that forces a verdict, amber is the one worth looking at, and info takes no
 * hue at all — a third colour for "nothing is wrong here" would spend the
 * channel on the one band that never needs it.
 *
 * Keyed by the label `computeIssues` writes rather than by position, so a
 * reordered or filtered tally cannot silently paint warnings red.
 */
const SEVERITY_INK: Record<string, string> = {
  Critical: "bg-red-500/85",
  Warning: "bg-amber-500/80",
  Info: "bg-foreground/25",
};

/**
 * One thing this app has to be able to reach.
 *
 * Services and folders in a single shape rather than two lists drawn alike: a
 * drive that has been unplugged stops this app as completely as a missing token
 * does, and the card below neither sorts nor counts them differently. The count
 * on the title line used to be worked out separately from the rows it described,
 * which is a figure and a list free to disagree.
 *
 * `why` is written for the failure and read only there — "no read token", not
 * "connected/not connected". A row that only ever appears when something is
 * wrong has no use for the word for when it is right.
 */
type Check = {
  name: string;
  ok: boolean;
  /** What is the matter, in the words the settings page would use. */
  why: string;
  /** The whole of what the name is a part of, where it is a part. */
  title?: string;
};

export function DashboardView({ data }: { data: Dashboard }) {
  const { now, headline, work, recent, system } = data;

  const checks: Check[] = [
    { name: "TMDb", ok: system.connections.tmdb, why: "no read token" },
    {
      name: "Jackett",
      ok: system.connections.jackett,
      why: "no indexer — the queue cannot fill",
    },
    { name: "qBittorrent", ok: system.connections.qb, why: "not configured" },

    // A folder by its own name, which is the last segment: every one of these
    // used to be labelled "Folder" and identified by a path truncated from its
    // far end — the end that says which folder it is — so three drives read as
    // three rows of the same word. Where it lives is what a failure prints,
    // since a folder called "Movies" says nothing about which drive has gone.
    ...now.roots.map((root) => {
      const { name, where } = folderParts(root.path);
      return {
        name,
        ok: root.reachable,
        why: `not reachable — ${where || root.path}`,
        title: root.path,
      };
    }),
  ];

  const down = checks.filter((check) => !check.ok);
  const up = checks.filter((check) => check.ok);

  const hasWork =
    work.upgrades.count > 0 ||
    recent.finds.count > 0 ||
    work.dovi.count > 0 ||
    work.audio.count > 0 ||
    work.issues.filmsAffected > 0 ||
    work.showsMissing.shows > 0;

  return (
    <div className="flex flex-col gap-12">
      <Welcome />

      {/*
       * Six figures, the verdict first and its workings after. The score is
       * the whole library in one number, so it leads; then what you have, and
       * then what it costs — films, shows and the films short of a perfect
       * copy are all answers to "how many", storage and the space the buttons
       * below could give back are answers about the drive.
       *
       * The score is a tile like the rest rather than a bar of its own. It had
       * a track under it, marked where the bands begin, and the track was the
       * more accurate drawing — but it made one of six readings twice the
       * height of the other five and drew the eye first for being a shape
       * rather than for being the number that matters most. A row of figures
       * only works as a row.
       *
       * Wider gutters than the charts use. Six columns of two lines each read
       * as a paragraph of small print when they are set as close as bars in a
       * chart; the space between them is what makes each one a figure you stop
       * at rather than a run of text you scan past.
       *
       * On the column's own gap and nothing more. This row used to hold itself
       * off at both ends — a little above, a little more below — which made
       * the first three joins on the page three different distances, and a
       * page whose spacing changes as you scroll reads as drifting rather than
       * as emphasis. Two measures do the whole page now: `gap-12` between the
       * blocks, `gap-8` between the parts of one.
       */}
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total score" value={headline.score} index={0} />
        <Stat label="Films" value={headline.films} index={1} />
        <Stat label="Shows" value={headline.shows} index={2} />
        <Stat label="Needs upgrade" value={headline.needsUpgrade} index={3} />
        <Stat
          label="Total storage"
          value={headline.libraryBytes}
          format={size}
          index={4}
        />
        {/* Tilde on the whole total where any audio task's saving is inferred
            rather than measured, the same mark the audio panel carries. */}
        <Stat
          label="Space to save"
          value={headline.savableBytes}
          format={(n) =>
            `${work.audio.estimated && work.audio.count > 0 ? "~" : ""}${size(n)}`
          }
          index={5}
        />
      </div>

      {recent.added.length > 0 && (
        <Card title="Recently added" index={0}>
          <RecentShelf items={recent.added} />
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}

      <section className="flex flex-col gap-12">
        <SectionRule>Needs doing</SectionRule>

        {!hasWork && (
          <p className="text-sm opacity-45">
            Nothing outstanding — no upgrades queued, no rewrites to run and no
            open issues.
          </p>
        )}

        {/*
         * Five kinds of work as five figures, in the row the page already
         * opens with.
         *
         * Each of these was a card of its own — a display-sized title, a hint,
         * a rule, two figures and a link — and five of them stacked read as
         * five pages of chrome around ten numbers. The work is not five
         * subjects; it is one question asked five ways, and the answer to each
         * is a count and somewhere to go.
         *
         * Every label names its own unit, because nothing explains them from
         * underneath any more: "Releases found", not "Upgrade queue" over a
         * number that could as easily have been films. A figure whose caption
         * needs a second line is a caption that has not been written yet.
         *
         * Ordered by how much the work is owed. What has been found for you
         * and will not keep comes first, then the two rewrites this app can do
         * on its own, then the gaps — which are a fact about a season rather
         * than a job with a button.
         */}
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {work.upgrades.count > 0 && (
            <WorkTile
              index={0}
              href="/upgrades"
              label="Upgrades found"
              value={work.upgrades.count}
            />
          )}

          {recent.finds.count > 0 && (
            <WorkTile
              index={1}
              href="/upgrades?t=downloads"
              label="Wishlist finds"
              value={recent.finds.count}
            />
          )}

          {work.dovi.count > 0 && (
            <WorkTile
              index={2}
              href="/jobs"
              label="DV P7 to P8.1"
              value={work.dovi.count}
            />
          )}

          {work.audio.count > 0 && (
            <WorkTile
              index={3}
              href="/jobs?t=audio"
              label="Strip Audio"
              value={work.audio.count}
            />
          )}

          {work.showsMissing.shows > 0 && (
            <WorkTile
              index={4}
              href="/library?t=tv&tf=incomplete"
              label="Missing episodes"
              value={work.showsMissing.episodes}
            />
          )}
        </div>

        {work.issues.filmsAffected > 0 && (
          <Card
            title="Open issues"
            hint={`${count(work.issues.filmsAffected)} ${work.issues.filmsAffected === 1 ? "film" : "films"}`}
            index={0}
          >
            {/* Red, amber, and the page's own ink — the three tones the film
                page and `/how-it-works` already spend on a severity, so a
                critical reads as the same thing wherever you meet it. */}
            <Coverage
              segments={work.issues.bySeverity}
              tones={work.issues.bySeverity.map(
                (band) => SEVERITY_INK[band.label] ?? SEVERITY_INK.Info,
              )}
            />

            {work.issues.filmsCritical > 0 && (
              // Films, where the bar counts issues: one film can hold three of
              // them, and a critical is the severity that forces an upgrade
              // verdict — the only one that changes what the app thinks of a
              // film, which is worth a sentence of its own.
              <p className="text-sm text-red-700 dark:text-red-300">
                {count(work.issues.filmsCritical)}{" "}
                {work.issues.filmsCritical === 1 ? "film has" : "films have"} a
                critical issue.
              </p>
            )}

            {/* Each check in words, from the catalogue that raises it. No
                storage figure beside the counts: the bytes are the size of the
                films an issue happens to sit on, not the size of the problem —
                one truncated file is worse than sixty low-bitrate encodes, and
                a terabyte printed next to it says the opposite. */}
            <Bars
              slices={work.issues.byCode}
              unit="occurrences"
              showBytes={false}
            />
          </Card>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}

      {/*
       * What is not answering, spelled out — and what is, named and nothing
       * more.
       *
       * This was a list of five identical rows, every one of them carrying a
       * coloured dot, a name and the word "connected". Four of the five say the
       * same thing on every visit of a working library, and the page has thrown
       * out three coverage bars already for exactly that: a panel that reads the
       * same every time is one you have stopped seeing, which costs you the row
       * that was going to tell you something. Green is the expensive way to
       * print "no news" — five dots of it, and the one red dot among them is
       * competing with four others for the eye rather than being the only
       * coloured thing on a page.
       *
       * So the card is split by state rather than by kind. A failure keeps the
       * full row — a red dot, the name, and why, which is the only text here
       * anyone has ever needed to read — and everything reachable collapses to
       * its name in a chip. The chips are not a status list; they are the roll
       * of what this app is wired to, and their being quiet is the report. When
       * something drops it leaves the chips and appears above them with a
       * sentence, which is a change in shape rather than a change in hue, and a
       * shape is legible from further away.
       *
       * That also means the card sizes itself to the news. Working, it is a
       * title and one line of chips; broken, it is as many rows as there are
       * things wrong, and the rows are the count — "2 of 5 not available" over
       * a list of exactly two rows is the list read aloud before you read it,
       * and a tally that says less than the thing it is tallying.
       *
       * Nothing on the title line but the title. The Settings link went with the
       * count: the rail holds Settings on every page of this app, so a second
       * way in, printed at eleven point in the corner of one card, is a shortcut
       * to somewhere you were never more than one click from. A card with a verb
       * on it should be one you can only act on there.
       *
       * The disc comparison band has gone the same way. It was a coverage bar of
       * three states which is fixed for a matched library — a census of what
       * this app has been able to judge, not a state that can go wrong between
       * two visits — and the census is `/stats`, which the rail also holds.
       *
       * "System" survives as the title, now that there is one band and no band
       * labels: the card holds three services and however many drives, and no
       * narrower word covers both.
       */}
      <Card title="System" index={0}>
        {down.length > 0 && (
          // Ruled apart, as every list in this app is: these are short lines run
          // across the width of the card, and without a hairline between them
          // the eye pairs a name with the wrong reason as soon as one wraps.
          <ul className="ruled flex flex-col">
            {down.map((check) => (
              <DownRow key={check.name} check={check} />
            ))}
          </ul>
        )}

        {up.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {up.map((check) => (
              <OkChip key={check.name} check={check} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * The page saying hello.
 *
 * Set in the display face rather than the wordmark's: Jim Nightshade belongs to
 * the mark in the rail and nowhere else — an app whose logo face turns up as a
 * page heading has two logos. Instrument Sans at this size is the same voice
 * every other heading here uses, only louder, which is what a first line should
 * be.
 *
 * The greeting and nothing else. A sentence of totals under it — films,
 * episodes, terabytes, folders, when it was last read — restated figures the
 * page goes on to draw properly, and it read as a paragraph you had to get past
 * before the page began.
 *
 * The scan button stood here too, as the last of what "Quick actions" was: two
 * outlined cards, each with a title, a paragraph and a timestamp, taking a band
 * of the page to offer two buttons that were always one pass — `scanner.ts`
 * starts a sweep the moment a scan finishes. It is in the rail now, under the
 * block that reports it, because a scan is started from a page and finished
 * somewhere else, and this page is a reading rather than a console.
 *
 * So the header is one line and its rule. Nothing on this page is pressed any
 * more; the figures are links and the work is where they go.
 */
function Welcome() {
  return (
    // No margin of its own. The page's `py-8` is the same 2rem the rail spends
    // above its wordmark, so the greeting starts on the line the app's name
    // starts on and the first thing said reads across the two columns. It also
    // puts this page where every other one already began: theirs open straight
    // into their first block, and the dashboard was the only one standing off
    // the top.
    <header className="row-enter flex flex-col gap-5">
      <h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Welcome back
      </h1>

      {/* The same hairline every heading in this app stands on — weighted
          where the words begin and trailing off away from them, so it reads as
          this title's own rule rather than as a band drawn across the page. */}
      <div aria-hidden className="rule-head" />
    </header>
  );
}

/**
 * A band's name, set exactly as the headings above it are.
 *
 * These were 11px uppercase over a gradient rule of their own — a third kind of
 * heading on a page that already had two, and the quietest of the three despite
 * naming the largest thing. Now they are the heading this page uses everywhere:
 * the display face at a card's size, standing on the same hairline that runs
 * under "Recently added" and under the greeting. One heading, one rule, and the
 * bands read as the page's own parts rather than as labels stuck above them.
 */
function SectionRule({ children }: { children: React.ReactNode }) {
  return (
    <div className="row-enter flex flex-col gap-2">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {children}
      </h2>
      <div aria-hidden className="rule-head" />
    </div>
  );
}

/**
 * One kind of outstanding work, as the same figure the page opens with.
 *
 * Literally the same figure: `Stat` itself, wrapped in the link rather than
 * redrawn beside it, so the two rows cannot drift apart as either is edited.
 * The label is the whole caption — a line of explanation under each number was
 * five subtitles on a row whose numbers already say what they are, and a label
 * that needs one is a label to rewrite instead.
 *
 * Nothing happens when you hover it. Every other target in this app lights up
 * under the pointer, and a row of figures is the one place that reads as noise:
 * they are set as a row to be taken in at once, and five surfaces waking up in
 * turn as the pointer crosses them is motion with nothing to say. The cursor
 * already says it is a link.
 */
function WorkTile({
  index,
  href,
  label,
  value,
}: {
  index: number;
  href: string;
  label: string;
  value: number;
}) {
  return (
    <Link href={href} className="block">
      <Stat label={label} value={value} index={index} />
    </Link>
  );
}

/**
 * The newest arrivals, in a shelf that runs off the side of the page.
 *
 * Scrolling rather than wrapping, which is the difference between a row and a
 * grid. Fifteen posters wrapped would be three rows deep and would push the
 * page's actual subject — what needs doing — below the fold, to show you
 * something you already know you added. One row admits it is a glance.
 *
 * `overflow-x-auto` on the strip alone, never on the page: a body that scrolls
 * sideways is a layout bug, and this is the one piece of content wide enough to
 * cause it.
 *
 * It runs the full width of the viewport, not the width of the reading measure
 * and not the width of the column either. Stopping at 64rem left the shelf
 * ending on a hard vertical line with empty page either side of it — which
 * reads as the row having run out rather than as there being more of it.
 *
 * The margins are `50% - 50vw ∓ 7rem`: half the strip's own box, less half the
 * viewport, and then the rail. The two sides differ by it and that is the whole
 * reason they are written separately — the rail is what makes this column's
 * centre sit 7rem right of the viewport's, so a single `mx` cannot land on both
 * edges at once. It used to be one value, `+ 7rem`, which put the right edge on
 * the viewport and the left edge exactly on the column's. That left edge is the
 * one place it should not be: the shelf ended precisely where the rail began,
 * so a poster leaving to the left dissolved *at* the rail rather than passing
 * behind it. Nothing was ever under the rail to be seen through it, which is a
 * frosted panel with nothing to frost. `- 7rem` on the left carries the strip
 * the last 14rem to the viewport's own edge, under the rail, where the posters
 * now go.
 *
 * Each padding cancels its own margin, so both ends still rest on the page's
 * gutter. What changed is where the row can travel to, not where it sits.
 *
 * Under `md:` the rail is a drawer rather than a column and the page is already
 * full width, so the plain gutter cancellation is the whole job.
 *
 * The right end is masked rather than cut. A scrolling row that stops dead at a
 * straight edge looks like a rendering fault; one that dissolves says there is
 * more of it that way. The fade is narrower than the padding, so at either
 * extreme of the scroll it falls on empty space — a poster is never sitting
 * half-faded while the row is stationary, only while it is on its way out. The
 * left end keeps its fade for the narrow screen, where there is no rail to
 * arrive behind; in the column it falls under the rail, which is now the thing
 * a poster disappears into.
 *
 * And no bar under it: the fade is already the affordance, and a scrollbar
 * drawn across a row of artwork is a rule through a picture. See `.no-scrollbar`
 * in globals.css for why this one strip opts out of the app's own.
 */
const SHELF_MASK =
  "[mask-image:linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]";

/** What a tile is, for the tooltip and the screen reader that lost the caption. */
const nameOf = (item: Dashboard["recent"]["added"][number]) =>
  item.episodes === undefined
    ? item.title
    : `${item.title} — ${count(item.episodes)} ${item.episodes === 1 ? "episode" : "episodes"}`;

function RecentShelf({ items }: { items: Dashboard["recent"]["added"] }) {
  /* The shelf is a place back returns to now, and a tile that replays its
     arrival on the way back is a tile the poster is flying home to while it
     fades in underneath. Same decision every other shelf makes — see
     `useEntrance` in app/return-to.tsx. */
  const entrance = useEntrance();

  return (
    <ul
      className={`no-scrollbar -mx-6 flex gap-4 overflow-x-auto px-6 sm:-mx-8 sm:px-8 md:mr-[calc(50%-50vw+7rem)] md:ml-[calc(50%-50vw-7rem)] md:pr-[calc(50vw-50%-7rem)] md:pl-[calc(50vw-50%+7rem)] ${SHELF_MASK}`}
    >
      {items.map((item, i) => (
        <li
          key={item.posterKey}
          style={stagger(i)}
          className={`${entrance} w-32 shrink-0`}
        >
          <Link
            href={item.href}
            /* The name the tile no longer prints. A wall of artwork with
               nothing written under it still has to be navigable by anything
               that cannot see a poster, and hovering one should still say what
               it is — so the title moves off the page and into the link. */
            aria-label={nameOf(item)}
            title={nameOf(item)}
            className="glow block rounded-control"
          >
            <span className="relative block">
              {item.poster || item.posterRemote ? (
                <Art
                  src={item.poster}
                  remote={item.posterRemote}
                  version={item.artAt}
                  // A show's poster is named by its key and a film's by its
                  // path, which is what `/library` and `/show` already do — so
                  // the tile travels into the page it opens either way.
                  transitionName={posterName(item.posterKey)}
                  // 128pt of poster is 256 device pixels on the screens these
                  // are looked at on, which is the next bucket up — w185 was
                  // the right ask at 96 and is a soft picture at this size.
                  // It also puts the local file on the cached 640 thumbnail
                  // rather than a full-resolution scan off the drive: `Art`
                  // maps the two together, and w185 was in neither map.
                  size="w342"
                  loading="lazy"
                  className="h-48 w-32 rounded-control object-cover ring-1 ring-line"
                />
              ) : (
                <span className="block h-48 w-32 rounded-control bg-surface-strong" />
              )}

              {/* How many episodes this one poster is standing in for. Over the
                  artwork rather than under the title, because it is a fact
                  about the picture — this is not one thing, it is twelve — and
                  a line of text below would read as a subtitle instead. */}
              {item.episodes !== undefined && (
                <span className="absolute top-1.5 right-1.5 rounded-chip bg-background/85 px-1.5 py-0.5 text-[10px] font-medium tabular-nums opacity-90 ring-1 ring-line backdrop-blur">
                  {count(item.episodes)} ep{item.episodes === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A library folder as a name and a place, from the path it was configured with.
 *
 * The last segment is what anyone calls the folder and the rest is where it
 * lives, which is the split every file browser makes and the one a row of
 * drives needs: truncation eats the end of a line, and the end of a path is the
 * only part that tells two of them apart.
 *
 * A trailing slash is dropped first so `/Volumes/Media/` names itself `Media`
 * rather than nothing, and a root path keeps its own slash as its name — there
 * is no segment left to use, and an empty label is worse than a literal one.
 */
function folderParts(path: string) {
  const clean = path.replace(/\/+$/, "");
  const cut = clean.lastIndexOf("/");
  return cut > 0
    ? { name: clean.slice(cut + 1), where: clean.slice(0, cut) }
    : { name: clean || "/", where: "" };
}

/**
 * Something that is not answering, and why.
 *
 * The dot is red and there is no other colour it can be, because this row is
 * only ever drawn for a failure. It is the one place on this card a hue is
 * spent, which is what makes it worth spending: red among five neutral chips is
 * an alarm, red among four green dots is a colour scheme.
 *
 * The reason is the row rather than a note beside a state. There is no "not
 * available" printed anywhere visible — the row's existence says that, and the
 * words are free to say the useful half instead: which token is missing, which
 * volume has gone. The screen reader gets the state said plainly, since a shape
 * it cannot see is not a shape.
 */
function DownRow({ check }: { check: Check }) {
  return (
    <li className="flex items-center gap-3 py-2.5" title={check.title}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
      {/* Capped rather than merely unshrinkable: a service's name is two words
          at most, but a folder's is whatever it was called on the drive, and
          one long one would push its own reason off the row. */}
      <span className="max-w-[60%] shrink-0 truncate text-sm">
        {check.name}
      </span>
      <span className="sr-only">not available —</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs opacity-45">
        {check.why}
      </span>
    </li>
  );
}

/**
 * Something that is answering, as its name and nothing else.
 *
 * The chip this app already uses everywhere — hairline ring, chip radius,
 * eleven point — and no dot, no tick and no word. Every mark that could go on
 * one of these would be a mark that is on all of them, which carries no
 * information and costs the page a colour it is otherwise spending on one thing.
 * Being here is the whole message; the ones that are not here are above, in
 * sentences.
 *
 * A folder keeps its path in the title, where it is a tooltip rather than a
 * column: which drive a working folder sits on is a settings question, and the
 * page that answers it is one link away on the title line.
 */
function OkChip({ check }: { check: Check }) {
  return (
    <li
      title={check.title}
      className="rounded-chip px-2 text-[11px] leading-[22px] font-medium opacity-60 ring-1 ring-line-strong ring-inset"
    >
      {check.name}
      <span className="sr-only"> — available</span>
    </li>
  );
}
