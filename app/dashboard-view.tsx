"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, ViewTransition } from "react";

import { Art } from "./art";
import { languageLine } from "./jobs/task-list";
import { Card, Stat } from "./charts";
import {
  checksFirst,
  doviRefusal,
  DoviConvertConfirm,
  DoviNotices,
  EL_LABEL,
  EL_TITLE,
  useDoviConvert,
} from "./dovi-convert";
import { ago, count, size } from "./format";
import { TrackPicker } from "./jobs/track-picker";
import { DoviDetails } from "./jobs/dovi-details";
import { useClosing, useLingering } from "./modal";
import { ReleaseDetails } from "./release-details";
import { ReleaseSearchModal } from "./release-search";
import { rememberListing, useEntrance } from "./return-to";
import { stagger } from "./stagger";
import type { Dashboard, DuplicateFilm, WorkFilm } from "@/lib/dashboard";
import type { AudioTask, DoviTask } from "@/lib/queue-tasks";
import { compareId, movieId, posterName } from "@/lib/routes";
import {
  queueTheme,
  ScoreBadge,
  SCORE_PLATE,
  scoreTheme,
} from "./score-circle";
import type { UpgradeQueueItem } from "@/lib/upgrade-sweep";
import { ScanFab } from "./scan-fab";

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

export function DashboardView({
  data,
  greeting,
  jackettReady,
}: {
  data: Dashboard;
  greeting: string;
  /** Two of the four passes go out to the indexers and cannot run without it. */
  jackettReady: boolean;
}) {
  const { now, headline, work, recent, system } = data;
  const router = useRouter();

  /**
   * The three queues' dialogs, one piece of state each.
   *
   * Held apart rather than as one "whatever is open", because they are three
   * different questions about three different records and a single slot would
   * have to be narrowed back to a type on the way out. Three `useState` calls
   * is the cheaper honesty.
   *
   * Each is kept past the click that closes it — `useLingering` — so the panel
   * plays its way out rather than blanking a frame before it has finished
   * leaving. The same pairing every list in this app makes with its dialogs.
   */
  const [release, setRelease] = useState<UpgradeQueueItem | null>(null);
  const readingRelease = useLingering(release);
  /** And the whole field for that film, which is a dialog of its own. */
  const [finding, setFinding] = useState<UpgradeQueueItem | null>(null);
  const searching = useLingering(finding);

  const [converting, setConverting] = useState<DoviTask | null>(null);
  const readingConvert = useLingering(converting);
  /** The film a Convert has been pressed on, which is asked before it runs. */
  const [asking, setAsking] = useState<DoviTask | null>(null);
  const askShown = useClosing(asking !== null);

  const [stripping, setStripping] = useState<AudioTask | null>(null);
  const picking = useLingering(stripping);

  /**
   * The conversion flow, shared with the jobs page — see app/dovi-convert.tsx.
   *
   * Its `busy` is what greys every rewrite offered on this page, the audio
   * dialog included: one rewrite at a time is a rule about the drive rather
   * than about the tab, and a Continue that promised otherwise here would be
   * refused by the server a moment later.
   */
  const dovi = useDoviConvert();

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
    work.showsMissing.shows > 0;

  return (
    <div className="flex flex-col gap-12">
      {/* Fixed, so it is outside this column and outside the page's own scroll
          — see `ScanFab`. It is in the dashboard rather than the layout because
          it belongs to this page: the rail carries what is true from wherever
          you are standing, and this is a verb. */}
      <ScanFab jackettReady={jackettReady} />

      <Welcome greeting={greeting} />

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
            Nothing outstanding — no upgrades queued and no rewrites to run.
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
              // The shelf, cut the way this figure counts: the films the
              // sweep has a better copy waiting for are a section of it.
              href="/library?g=verdict"
              label="Upgrades found"
              value={work.upgrades.count}
            />
          )}

          {recent.finds.count > 0 && (
            <WorkTile
              index={1}
              href="/wishlist"
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

        {/*
         * And who the work is, under the figures that count it.
         *
         * Three queues, three shelves, in the order the row of figures already
         * puts them: what an indexer has found for you, then the two rewrites
         * this app can run on its own. Each is the head of its own list — the
         * best releases, the largest conversions, the biggest savings — because
         * a shelf is fifteen posters of a backlog that may be four hundred, and
         * the fifteen it shows should be the fifteen worth doing first.
         *
         * The figures above are the way to each list, and the posters are not a
         * second one. A tile opens its own film, which is where the work is
         * actually done — and the figure in its corner is why it is in the
         * queue at all, so the shelf can be read without the page it came from.
         *
         * Which is also why none of these headings carries a count any more.
         * Each said "4 films" beside a title, and the row of figures directly
         * above says the same thing at the size a figure deserves — a heading
         * that repeats the number over it is a page telling you twice and
         * emphasising neither. The titles name the queues; the figures count
         * them.
         *
         * Only where there is something in them. A heading over an empty strip
         * is the page reporting on its own layout.
         */}
        {/*
         * The same film twice, before the queues that are about films you only
         * have once.
         *
         * First of the four because it is the only backlog here that is pure
         * waste: an upgrade is a film that could be better, a conversion is a
         * file that could be smaller, and both are improvements to a library
         * that is already right. Two copies of one film is a library that is
         * wrong, and the drive is paying for it tonight.
         *
         * It is also the only one with no button. The other three end in a
         * press this app can make on your behalf — send the magnet, run the
         * conversion, strip the tracks — and nothing here will ever delete a
         * film for you. What a press does here is show you the two files
         * properly, which is why the tile keeps the comparison under the poster
         * rather than in the corner: the corner holds a figure, and this queue
         * is answered with a choice.
         */}
        {work.duplicates.films.length > 0 && (
          <Card
            title="Duplicates"
            index={1}
            // Where the rest of them are, on the shelf that already has a
            // filter for exactly this — the card holds six, and a library that
            // has been re-ripped a few times has more.
            action={
              work.duplicates.count > work.duplicates.films.length ? (
                <Link
                  href="/library?f=dupes"
                  className="text-[11px] opacity-45 transition-opacity hover:opacity-80"
                >
                  All {work.duplicates.count} →
                </Link>
              ) : undefined
            }
          >
            {/* The size in the corner, the pair under the pointer. */}
            <DuplicateShelf films={work.duplicates.films} />
          </Card>
        )}

        {work.upgrades.films.length > 0 && (
          <Card title="Upgrade queue" index={2}>
            {/* The library shelf's own pairing over the same film, in the same
                order: the gain leads, and the score keeps the corner every
                shelf in this app keeps its reading in. It was the gain alone —
                a number with nothing to be more than, on the one shelf whose
                whole subject is the difference between two of them.

                See the badge on `LibraryView`'s tile, which is this markup. */}
            <WorkShelf
              films={work.upgrades.films}
              badge={(film) => (
                <>
                  <span
                    className={`${SCORE_PLATE} text-emerald-600 dark:text-emerald-400`}
                    title={`A release was found that would score ${film.item.hit.score} — ${film.figure} more than this copy`}
                  >
                    +{film.figure}
                  </span>
                  {/* `queueTheme`, not the library's banding — amber unless
                      the copy is a hundred.

                      The default bands a score on its own merits, which makes
                      an 89 green, and green on this shelf is the one colour it
                      cannot be: every film here is one the sweep found a better
                      copy of, so a green plate says "nothing to do" on a poster
                      whose whole reason for being on the page is that there is.
                      Only a hundred closes the question, which is the rule the
                      release lists already read by. */}
                  <ScoreBadge
                    score={film.item.currentScore}
                    theme={queueTheme(film.item.currentScore)}
                    title={`This copy scores ${film.item.currentScore} of 100`}
                  />
                </>
              )}
              reading={(film) => `+${film.figure}`}
              // What the release is, which is what the queue is offering — the
              // library shelf's own pair of facts, read off the found release
              // rather than off the copy it would replace.
              subtitle={(film) =>
                [film.item.hit.resolution, film.item.hit.releaseType]
                  .filter(Boolean)
                  .join(" · ")
              }
              onOpen={setRelease}
            />
          </Card>
        )}

        {work.dovi.films.length > 0 && (
          <Card title="Dolby Vision conversion queue" index={3}>
            {/* The file's own size, which is what a P7 to P8.1 rewrite has to
                read and write — the cost of the job rather than its yield. */}
            <WorkShelf
              films={work.dovi.films}
              badge={(film) => (
                <span className={SHELF_READING}>{size(film.figure)}</span>
              )}
              reading={(film) => size(film.figure)}
              // The jobs page's own line over a conversion, fact for fact.
              subtitle={(film) =>
                [
                  "Profile 7",
                  film.item.el && EL_LABEL[film.item.el],
                  size(film.item.sizeBytes),
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              onOpen={setConverting}
            />

            {/* What a check found, or what a rewrite failed with. Inside the
                card rather than at the head of the page, because it is an
                answer about one of these files and belongs beside them. */}
            <DoviNotices error={dovi.error} notice={dovi.notice} />
          </Card>
        )}

        {work.audio.films.length > 0 && (
          <Card title="Strip Tracks queue" index={4}>
            {/* ≈ where the saving is bitrate × runtime, and nothing at all
                where it was counted.

                The minus that used to lead a counted figure was carried over
                from the jobs page, where it sits in a column headed "freed" and
                reads as the direction of the change. Over a poster there is no
                column and no heading: it is a lone glyph in the corner of a
                picture, and at ten point it reads as a hyphen or as part of the
                number before anyone reads it as a sign. Nothing on this shelf
                is a figure that could go the other way — the whole queue is
                space given back — so the sign was carrying no information the
                shelf's own title did not.

                The ≈ stays, because it is the one mark here that changes what
                the number means. */}
            <WorkShelf
              films={work.audio.films}
              badge={(film) => (
                <span className={SHELF_READING}>
                  {film.estimated ? "≈" : ""}
                  {size(film.figure)}
                </span>
              )}
              reading={(film) =>
                `${film.estimated ? "≈" : ""}${size(film.figure)}`
              }
              // And the jobs page's own line over a removal: which languages
              // are going, and how big the file they are going from is.
              subtitle={(film) =>
                [
                  languageLine(film.item.languages),
                  `${size(film.item.sizeBytes)} file`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              onOpen={setStripping}
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

      {/* ------------------------------------------------------------------ */}

      {/*
       * What the three shelves open, each the same panel its own queue's page
       * opens — see app/release-details.tsx, app/jobs/dovi-details.tsx and
       * app/jobs/track-picker.tsx. Nothing here is a dashboard-shaped copy of
       * one: a poster that opened a lighter version of the real dialog would be
       * a fourth thing to learn and a place where the app disagreed with itself
       * about what a release, a conversion or a track removal is.
       */}

      {readingRelease && (
        <ReleaseDetails
          open={release !== null}
          title={readingRelease.title}
          year={readingRelease.year}
          poster={readingRelease.poster}
          posterRemote={readingRelease.posterRemote}
          posterVersion={readingRelease.artAt}
          hit={readingRelease.hit}
          gain={readingRelease.hit.delta}
          currentScore={readingRelease.currentScore}
          checkedLabel={`Checked ${ago(readingRelease.checkedAt)}`}
          source="upgrade"
          film={{ href: `/film/${movieId(readingRelease.path)}` }}
          onward={{
            label: "Compare",
            go: () => {
              // The crumb the queue's own rows leave, for the same reason: the
              // delegated listener in return-to.tsx only sees anchors, and this
              // navigates from a handler.
              rememberListing();
              router.push(`/compare/${compareId(readingRelease.compareKey)}`);
            },
          }}
          onMore={() => {
            setRelease(null);
            setFinding(readingRelease);
          }}
          onClose={() => setRelease(null)}
        />
      )}

      {searching && (
        <ReleaseSearchModal
          open={finding !== null}
          subject={{ kind: "movie", path: searching.path }}
          title={searching.title}
          subtitle={searching.year ? String(searching.year) : undefined}
          posterPath={searching.posterRemote}
          source="upgrade"
          configured={system.connections.jackett}
          onClose={() => setFinding(null)}
        />
      )}

      {readingConvert && (
        <DoviDetails
          task={readingConvert}
          open={converting !== null}
          layer={readingConvert.el ? EL_LABEL[readingConvert.el] : undefined}
          layerTitle={
            readingConvert.el ? EL_TITLE[readingConvert.el] : undefined
          }
          size={size(readingConvert.sizeBytes)}
          checkFirst={checksFirst(readingConvert)}
          refusal={doviRefusal(readingConvert, dovi.busy)}
          href={`/${readingConvert.kind === "movie" ? "film" : "episode"}/${movieId(readingConvert.path)}`}
          onStart={() => {
            // The details close on the way through, whichever of the two this
            // is: a check runs here and now, a rewrite hands over to the
            // question below. The jobs page's own rule, kept because it is the
            // same press.
            setConverting(null);
            if (checksFirst(readingConvert)) void dovi.check(readingConvert);
            else setAsking(readingConvert);
          }}
          onClose={() => setConverting(null)}
        />
      )}

      {askShown && asking && (
        <DoviConvertConfirm
          task={asking}
          open={asking !== null}
          keepingEl={work.dovi.keepingEl}
          busy={dovi.starting}
          onConfirm={() => void dovi.run(asking).then(() => setAsking(null))}
          onCancel={() => setAsking(null)}
        />
      )}

      {/* Keyed by the file, so choosing on one poster and then another does not
          hand the second film the first one's ticks — the dialog seeds itself
          from the proposal once per mount, and without this the mount is
          shared. The jobs page keys it for the same reason. */}
      {picking && (
        <TrackPicker
          key={picking.path}
          task={picking}
          open={stripping !== null}
          blocked={
            dovi.busy
              ? "Something is already rewriting a file — wait for it"
              : undefined
          }
          onClose={() => setStripping(null)}
        />
      )}
    </div>
  );
}

/**
 * The page saying hello.
 *
 * Set in the wordmark's own face, and the only heading in the app that is. It
 * is not a second logo: it is the same sentence the rail starts, carried across
 * the gutter and finished — the app says its name, and then says hello in the
 * same hand. Every other heading here stays Instrument Sans, so a page's title
 * still reads as the app talking about the page rather than as the app talking.
 *
 * Jim Nightshade ships one weight, so nothing asks for a heavier one: `font-
 * semibold` here got the browser's synthetic smear, and a script face is the
 * one place that shows. `tracking-tight` went with it — the letters join, and
 * pulling them together only closes the joins up.
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
function Welcome({ greeting }: { greeting: string }) {
  return (
    // Level with the wordmark, and now for nothing but the arithmetic. The
    // page's `py-8` is the same 2rem the rail spends above its name, and the
    // heading is set at the wordmark's size and leading — 30px, `leading-none`
    // — so the two line boxes start on the same line and are the same height.
    //
    // The 4px this used to carry was the two faces disagreeing about where a
    // baseline sits inside an identical box. One face now, so the baselines
    // are the same measurement and the nudge is gone: the greeting and the
    // app's name rest on one line, and the first thing said reads across the
    // two columns.
    <header className="row-enter flex flex-col gap-5">
      <h1 className="font-logo text-3xl leading-none text-balance">
        {greeting}
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
 * One copy, on the panel a duplicate's poster keeps under it.
 *
 * The two lines are the same line with two things changed — the word in front
 * and how loudly it is drawn — because that is what makes them read as one
 * decision rather than two facts. `Keep` takes the app's own green, the colour
 * a settled verdict wears everywhere here; `Drop` is turned down to the opacity
 * `/compare` gives its losing columns, which is the same page saying the same
 * thing at a smaller size.
 *
 * The score keeps the film's own tone from `scoreTheme` rather than a colour of
 * this panel's choosing: a 91 has one colour in this app, and painting the
 * better copy green and the worse one red would invent a verdict the numbers
 * already carry.
 *
 * One line each, because the panel is as wide as a poster — 12rem — and this is
 * the glance that says whether the comparison is worth opening, not the
 * comparison. `/compare` prints forty rows; this prints the two that decide.
 */
function DuplicateLine({
  label,
  copy,
  keeping,
}: {
  label: string;
  copy: DuplicateFilm["keep"];
  keeping?: boolean;
}) {
  return (
    <span className={`flex flex-col ${keeping ? "" : "opacity-50"}`}>
      <span
        className={`text-[10px] font-medium tracking-[0.1em] uppercase ${
          keeping ? "text-emerald-600 dark:text-emerald-400" : "opacity-70"
        }`}
      >
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={`font-score text-base leading-none ${scoreTheme(copy.score).text}`}
        >
          {copy.score}
        </span>
        <span className="min-w-0 truncate text-[11px] opacity-60">
          {copy.resolution} {copy.releaseType}
        </span>
      </span>
    </span>
  );
}

/**
 * Films held twice, as the shelf every other queue on this page is.
 *
 * It was a grid of cards — poster, title, and the two copies laid out side by
 * side — and one section built like that among four shelves of artwork reads as
 * a different page that arrived in the middle of this one. The row is the
 * page's own form, and the form carries a claim worth keeping: everything here
 * is a film, and a film is a poster.
 *
 * What a duplicate needs that a queue item does not is somewhere to put the
 * comparison, and that is what `Tile.hover` is. At rest this is artwork with a
 * figure in the corner, exactly like the three shelves under it. Pointed at, the
 * copies rise out of the bottom edge — which is also the only part of this the
 * poster cannot say for itself, both copies being the same film and wearing the
 * same picture.
 *
 * The corner figure is the space, not the count. "2 copies" is a fact about the
 * shelf you are already looking at; gigabytes are what having them costs, and
 * they are what puts one of these ahead of another.
 */
function DuplicateShelf({ films }: { films: DuplicateFilm[] }) {
  return (
    <Shelf
      tiles={films.map((film) => ({
        key: film.key,
        href: `/compare/${compareId(film.key)}`,
        name: `${film.title}${film.year ? ` (${film.year})` : ""} — ${film.copies} copies, ${size(film.reclaimBytes)} to reclaim`,
        title: film.title,
        // The year, and how many of it there are. What the copies actually
        // differ by is the panel that rises on hover — three lines of figures
        // that no caption would hold — so this says only the fact that puts
        // the tile on the shelf at all.
        subtitle: [
          film.year,
          film.copies === 2 ? "2 copies" : `${film.copies} copies`,
        ]
          .filter(Boolean)
          .join(" · "),
        poster: film.poster,
        posterRemote: film.posterRemote,
        artAt: film.artAt,
        badge: <span className={SHELF_READING}>{size(film.reclaimBytes)}</span>,
        hover: (
          <span className="flex flex-col gap-1.5">
            <DuplicateLine label="Keep" copy={film.keep} keeping />
            <DuplicateLine label="Drop" copy={film.drop} />
            {/* How many there are, said only where it is not two — a pair is
                what this shelf is for and does not need announcing. */}
            <span className="text-[10px] tracking-wide uppercase opacity-40">
              {film.copies === 2 ? "2 copies" : `${film.copies} copies`}
            </span>
          </span>
        ),
      }))}
    />
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
 * Each side is written as the distance from this strip's own box to that edge
 * of the window, and the two are not the same distance, which is the whole
 * reason they are written separately.
 *
 * The left one is a constant: the page starts at the rail and stays there — see
 * the `md:pl-12` on `app/page.tsx` — so the strip's left edge is 14rem of rail
 * plus 3rem of gutter from the window, whatever the window is doing. 17rem,
 * both ways, and the negative margin carries the row the last of it *under* the
 * rail rather than stopping at it: a poster leaving to the left should pass
 * behind a frosted panel, and a panel with nothing behind it is nothing to
 * frost.
 *
 * The right one cannot be a constant, because it is everything the column did
 * not take: `100vw - 100% - 17rem`, the window less this box less what is to
 * the left of it. That figure grows as the screen does — the column stops at
 * 124rem and a 32-inch display has a foot of page beyond it — and it is the
 * figure that was wrong when the page stopped being centred. The margins were
 * `50% - 50vw ∓ 7rem` then, which is the arithmetic for a column with equal
 * gutters either side; left-aligned, that put the right end of the shelf
 * somewhere in the middle of the empty half, and the row ran out with the
 * screen plainly continuing past it.
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
/**
 * The plate a figure wears over a poster on these shelves.
 *
 * It was the corner slot's own markup, which was right while every shelf
 * printed one number. The upgrade queue prints two — see `UpgradeBadge` — so
 * the slot became a row that positions whatever it is given, and the plate is
 * what a single figure puts on to stand in it.
 */
const SHELF_READING =
  "rounded-full bg-background/85 px-2 py-0.5 font-display text-[11.5px] font-medium tabular-nums opacity-90 ring-1 ring-line backdrop-blur";

const SHELF_MASK =
  "[mask-image:linear-gradient(to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent)]";

/**
 * One poster on a shelf, whichever shelf it is.
 *
 * Four shelves ran on this page before this type existed and only the first was
 * written: the other three would have been copies of a paragraph of margin
 * arithmetic that nobody wants to get right twice. What actually differs
 * between them is two things — what the corner of the picture says, and whether
 * the poster is the one that travels.
 */
type Tile = {
  /** React's key, and the film's identity where a shelf claims the transition. */
  key: string;
  href: string;
  /** What it is, for the tooltip and the screen reader. */
  name: string;
  /**
   * The caption: what this is, and the line under it.
   *
   * The shelves printed nothing at all for a while, on the argument that a wall
   * of artwork is read by recognising it and a title under every poster is a
   * caption you have already skipped. That holds for the film you own and not
   * for the queues, where a tile stands for a piece of work rather than for a
   * film — what has to be read there is which conversion, of what size, in what
   * layer, and none of that is on the artwork.
   *
   * So it is the caption the rest of the app writes: the title in the page's
   * own weight and one grey line under it, exactly as `PosterTile` sets it on
   * the library shelf and the jobs page. Each shelf says what its own page
   * would say about the same record.
   */
  title: string;
  subtitle?: string;
  poster?: string;
  posterRemote?: string;
  artAt?: number;
  /**
   * The name the poster travels under, where this shelf is the one that owns
   * it. A view-transition name has to be unique on the page: the same film can
   * be in the upgrade queue *and* have Profile 7 to convert *and* have foreign
   * tracks to strip, and three posters claiming one name is a page where the
   * transition simply does not run. So one shelf claims and the rest link.
   */
  transitionName?: string;
  /**
   * What is printed over the artwork, top right.
   *
   * A node rather than a string, because one shelf's reading is a pair. The
   * upgrade queue prints what the library's own shelf prints of the same film —
   * the gain and the score it would be added to — and two plates cannot be a
   * string. Every other shelf hands one figure in `SHELF_READING`, which is
   * what a string used to be wrapped in here.
   */
  badge?: React.ReactNode;
  /**
   * What the poster does instead of going to `href`, on the shelves whose click
   * is a question rather than an address.
   *
   * The queues have one: what a poster on them stands for is a decision — take
   * this release, convert this file, remove these tracks — and the page that
   * decision is made on is the queue's own, which is not where you are. So the
   * dialog comes here rather than sending you two pages away and back.
   *
   * `href` is still set on those tiles and still does something: it is what the
   * dialog's own poster and title link to, so the film is one press further in
   * rather than unreachable. Only the shelf's click changes.
   */
  onOpen?: () => void;
  /**
   * What the poster has to say when you point at it, drawn over its own lower
   * half.
   *
   * For the one shelf whose tile is not self-explanatory. A poster in a queue
   * stands for a film and a figure, and the figure fits in the corner; a poster
   * in the duplicates shelf stands for a *choice between two files*, which is
   * three lines of numbers that no corner will hold. Rather than give that
   * shelf a card of its own — five posters the size of paragraphs, next to four
   * shelves of artwork — the answer stays inside the tile and waits to be
   * asked.
   *
   * Inside the tile deliberately. This strip scrolls, and a scroll container
   * clips both axes: a panel hung below or beside the poster would be cut off
   * at the row's edge on the very tiles nearest it.
   */
  hover?: React.ReactNode;
};

function Shelf({ tiles }: { tiles: Tile[] }) {
  /* The shelf is a place back returns to now, and a tile that replays its
     arrival on the way back is a tile the poster is flying home to while it
     fades in underneath. Same decision every other shelf makes — see
     `useEntrance` in app/return-to.tsx. */
  const entrance = useEntrance();

  return (
    <ul
      /*
       * `-my-3 py-3` is room for the lift, and it is not optional.
       *
       * `overflow-x-auto` cannot scroll one axis and spill the other: the
       * moment either overflow is not `visible`, the other computes to `auto`
       * too, so this row clips its own top and bottom at exactly the poster's
       * edge. A tile that rises and turns under the pointer was being sliced
       * along both — measured at 8.7px of it, which is most of the lift.
       *
       * So the strip is given twelve pixels of its own inside and takes them
       * straight back outside, the way it already trades `-mx` against `px` to
       * bleed the artwork to the page's edges. The shelf occupies the same
       * band it always did; the tiles simply have somewhere to go.
       */
      className={`no-scrollbar -mx-6 -my-3 flex gap-4 overflow-x-auto px-6 py-3 sm:-mx-8 sm:px-8 md:mr-[calc(100%+17rem-100vw)] md:ml-[-17rem] md:pr-[calc(100vw-100%-17rem)] md:pl-[17rem] ${SHELF_MASK}`}
    >
      {tiles.map((tile, i) => {
        /* The name the tile no longer prints. A wall of artwork with nothing
           written under it still has to be navigable by anything that cannot
           see a poster, and hovering one should still say what it is — so the
           title moves off the page and into whatever the poster is. */
        const named = {
          "aria-label": tile.name,
          title: tile.name,
          className: "group flex w-full flex-col gap-2 text-left",
        };

        /*
         * The library's tile, at this shelf's size.
         *
         * `glow glow-over tilt` is `TILE_FRAME`'s own hover — the light that
         * follows the pointer across the picture, and the lift and turn that
         * say which one you are on. Nothing here drives it: the listener in
         * app/glow.tsx is one handler on the document that finds the nearest
         * `.glow`, so a tile joins the behaviour by wearing the classes.
         *
         * On the frame rather than on the link, which is where it was. A link
         * that glows is a rectangle of light behind a poster that does not
         * move; the frame is the thing with a picture in it, and the ring, the
         * badge and the panel all tilt with it as one object.
         *
         * Its own radius, ring and fill, taken off the `Art` inside it: the
         * glow's gradient inherits the border radius of the element it is on,
         * and `overflow-hidden` is what keeps the lift from carrying the
         * artwork's corners past the frame's.
         *
         * `rounded-card`, which is what a poster is drawn on everywhere else —
         * `TILE_FRAME`, the collection fans, the film page's own hero. This
         * shelf spent `rounded-control` on 8px against the library's 14 at
         * almost exactly the same size, which read as two shapes of tile for
         * one kind of thing. The hover panel below takes `rounded-b-card` with
         * it: it sits in the frame's bottom corners, so its curve is the
         * frame's or it is a corner drawn inside a corner.
         */
        const picture = (
          <span className="glow glow-over tilt relative block h-72 w-48 overflow-hidden rounded-card bg-surface-strong ring-1 ring-line">
            {tile.poster || tile.posterRemote ? (
              <Art
                src={tile.poster}
                remote={tile.posterRemote}
                version={tile.artAt}
                // The library's own ask, which is `Art`'s default: these are
                // now the size the shelves on `/library` draw, so they want the
                // same file. 192pt is 384 device pixels on the screens this is
                // looked at on, and w342 puts the local copy on the cached 640
                // thumbnail rather than a full-resolution scan off the drive —
                // `Art` maps the two together.
                size="w342"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}

            {/* What this poster is standing for — twelve episodes, four
                points of score, nine gigabytes. Over the artwork rather than
                under the title, because it is a fact about the picture and a
                line of text below would read as a subtitle instead. */}
            {tile.badge && (
              <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
                {tile.badge}
              </span>
            )}

            {/* Rising out of the bottom edge rather than fading in over the
                middle: the poster stays the picture, and what arrives reads as
                something that was already there being pulled up. Answers focus
                as well as the pointer, because a shelf of links is walked with
                Tab by anyone not using a mouse and the panel is the only place
                these numbers exist.

                `pointer-events-none` so the panel is never the thing under the
                cursor — the whole tile is one link, and a press that landed on
                a caption instead of the poster would be the same press with a
                different target. */}
            {tile.hover && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 rounded-b-card bg-gradient-to-t from-background via-background/95 to-transparent px-2 pt-6 pb-2 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 motion-reduce:transition-none">
                {tile.hover}
              </span>
            )}
          </span>
        );

        /*
         * And the whole frame is what travels, not the picture inside it.
         *
         * The name was on the `Art`, which is the mistake `PosterTile` already
         * documents: the image flies to the page it opens and leaves the ring
         * and the badge standing where the tile was, so the shelf comes apart
         * mid-flight. Round the frame, the tile arrives as one object — the
         * same pairing `/library` makes, under the same `posterName`, so a
         * film recognised here morphs into the poster on its own page.
         *
         * Only the shelf that claims the name is wrapped. The queues below
         * repeat each other's films and open dialogs rather than pages, and a
         * name claimed twice on one page aborts the transition for both — see
         * `Tile.transitionName`.
         */
        /* `PosterTile`'s own caption, class for class: the title at the page's
           text size and one grey line under it. Inside the link, because the
           title under a poster is part of the poster as far as anybody pressing
           it is concerned — the same call the shelves make. */
        const caption = (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span
              className="min-w-0 truncate text-sm font-medium"
              title={tile.title}
            >
              {tile.title}
            </span>
            {tile.subtitle && (
              <span className="min-w-0 truncate text-[11px] opacity-45">
                {tile.subtitle}
              </span>
            )}
          </span>
        );

        const travelling = tile.transitionName ? (
          <ViewTransition
            name={tile.transitionName}
            share="morph"
            default="none"
          >
            {picture}
          </ViewTransition>
        ) : (
          picture
        );

        return (
          <li
            key={tile.key}
            style={stagger(i)}
            className={`${entrance} w-48 shrink-0`}
          >
            {/* A button where the click is a dialog, an anchor where it is an
                address — never an anchor made to behave like a button. The
                browser's own handling of a link is the reason the recent shelf
                keeps one: middle-click, preview, open in a new tab, and the
                crumb the delegated listener in app/return-to.tsx leaves on the
                way out. None of that means anything for a poster that opens a
                panel over the page you are already on, and a link that goes
                nowhere is a promise the shelf cannot keep. */}
            {tile.onOpen ? (
              <button type="button" onClick={tile.onOpen} {...named}>
                {travelling}
                {caption}
              </button>
            ) : (
              <Link href={tile.href} {...named}>
                {travelling}
                {caption}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What a recent tile is, said out loud: a film, or a show and how much of it. */
const nameOf = (item: Dashboard["recent"]["added"][number]) =>
  item.episodes === undefined
    ? item.title
    : `${item.title} — ${count(item.episodes)} ${item.episodes === 1 ? "episode" : "episodes"}`;

function RecentShelf({ items }: { items: Dashboard["recent"]["added"] }) {
  return (
    <Shelf
      tiles={items.map((item) => ({
        key: item.posterKey,
        href: item.href,
        name: nameOf(item),
        title: item.title,
        subtitle: item.subtitle,
        poster: item.poster,
        posterRemote: item.posterRemote,
        artAt: item.artAt,
        // A show's poster is named by its key and a film's by its path, which
        // is what `/library` and `/show` already do — so the tile travels into
        // the page it opens either way. This is the shelf that claims a film's
        // name: it is the first on the page, and the queues below repeat each
        // other's films where this one repeats nothing.
        transitionName: posterName(item.posterKey),
        badge:
          item.episodes === undefined ? undefined : (
            <span className={SHELF_READING}>
              {count(item.episodes)} ep{item.episodes === 1 ? "" : "s"}
            </span>
          ),
      }))}
    />
  );
}

/**
 * The head of one backlog, as the films in it.
 *
 * The figures above say how much work there is; these say whose. A count is
 * something you either act on or scroll past, and four posters of films you
 * remember ripping is the thing that makes the queue feel owed — which is the
 * whole argument for a shelf on a page whose rule is that everything on it has
 * a verb.
 *
 * The tile opens the queue's own question, not the film.
 *
 * It opened the film once, on the argument that the figure above already links
 * the list and a poster is for the one film you recognised on the way past.
 * That is right about why the poster is there and wrong about what to do when
 * you recognise it: what you have recognised is a film with something outstanding
 * on it, and the film's page is not where the outstanding thing is decided. It
 * was a page you landed on, read, and left again — three navigations to reach a
 * dialog that could have opened where you were standing.
 *
 * So the poster opens the same panel the queue's own page opens on the same
 * record — the release the sweep found, the conversion, the tracks to remove —
 * and the film is still one press away inside it, on the poster and the name at
 * the top, which is where all three of those dialogs put it.
 */
function WorkShelf<T>({
  films,
  badge,
  reading,
  subtitle,
  onOpen,
}: {
  films: WorkFilm<T>[];
  /**
   * What this queue prints in the corner — a gain, a size, a saving.
   *
   * A node, because the upgrade queue's is the library's own pair. The two that
   * print one figure wrap it in `SHELF_READING` themselves, which is the plate
   * the slot used to apply for them.
   */
  badge: (film: WorkFilm<T>) => React.ReactNode;
  /**
   * The line under the title, read off the queue's own record.
   *
   * Per queue rather than shared, because what you need told about a tile is
   * whatever its own page tells you: the jobs page prints the layer and the
   * size over a conversion and the languages over a track removal, and a shelf
   * that stands in for those lists should not say something else. The record
   * travels with the tile already — see `WorkFilm.item` — so this is read on
   * the client from what the dialog behind the poster is going to open on.
   */
  subtitle: (film: WorkFilm<T>) => string;
  /**
   * The same figure in words, for the tooltip and the screen reader.
   *
   * Separate from `badge` now that a badge can be markup: the tile's accessible
   * name has always been "the film — what it is here for", and a React node
   * interpolated into a template literal is "[object Object]".
   */
  reading: (film: WorkFilm<T>) => string;
  /** The dialog this queue answers with, opened on the record behind the tile. */
  onOpen: (item: T) => void;
}) {
  return (
    <Shelf
      tiles={films.map((film) => ({
        key: film.posterKey,
        href: film.href,
        name: `${film.title} — ${reading(film)}`,
        title: film.title,
        subtitle: subtitle(film),
        poster: film.poster,
        posterRemote: film.posterRemote,
        artAt: film.artAt,
        badge: badge(film),
        onOpen: () => onOpen(film.item),
      }))}
    />
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
      className="rounded-chip px-2 font-display text-[11px] leading-[22px] font-medium opacity-60 ring-1 ring-line-strong ring-inset"
    >
      {check.name}
      <span className="sr-only"> — available</span>
    </li>
  );
}
