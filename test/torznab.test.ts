import assert from "node:assert/strict";
import { test } from "node:test";

import {
  feedError,
  parseCaps,
  parseTorznab,
  shareTrackers,
  trackersOf,
  withTrackers,
  type IndexerResult,
} from "../lib/torznab";

/**
 * The XML below is shaped like a real Jackett response, including the parts
 * that vary between indexers: size as an element on one and as a torznab
 * attribute on another, a magnet on one and only an info hash on the next.
 * Those differences are the whole reason this parser is not two lines.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <item>
      <title>Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.TrueHD.Atmos.7.1-FraMeSToR</title>
      <guid>https://example.org/details/1</guid>
      <comments>https://example.org/details/1</comments>
      <pubDate>Mon, 15 Apr 2024 09:00:00 +0000</pubDate>
      <size>85899345920</size>
      <jackettindexer id="example">Example Tracker</jackettindexer>
      <enclosure url="https://example.org/dl/1" length="85899345920" type="application/x-bittorrent" />
      <torznab:attr name="category" value="2045,2000" />
      <torznab:attr name="seeders" value="42" />
      <torznab:attr name="peers" value="50" />
      <torznab:attr name="magneturl" value="magnet:?xt=urn:btih:AAAA&amp;dn=Dune" />
    </item>
    <item>
      <title><![CDATA[Heat.1995.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP]]></title>
      <guid>abcdef-not-a-url</guid>
      <jackettindexer id="other">Other Tracker</jackettindexer>
      <torznab:attr name="size" value="16106127360" />
      <torznab:attr name="infohash" value="BBBBCCCCDDDD" />
      <torznab:attr name="seeders" value="3" />
      <torznab:attr name="category" value="2040" />
    </item>
  </channel>
</rss>`;

test("both items are read out of the feed", () => {
  assert.equal(parseTorznab(FEED).length, 2);
});

test("size is read whether it is an element or an attribute", () => {
  const [first, second] = parseTorznab(FEED);
  assert.equal(first.sizeBytes, 85899345920);
  assert.equal(second.sizeBytes, 16106127360);
});

test("leechers are derived from peers, which include the seeders", () => {
  const [first] = parseTorznab(FEED);
  assert.equal(first.seeders, 42);
  assert.equal(first.leechers, 8);
});

test("an escaped magnet is decoded back to a usable URI", () => {
  const [first] = parseTorznab(FEED);
  assert.equal(first.magnet, "magnet:?xt=urn:btih:AAAA&dn=Dune");
});

test("an item with only an info hash still yields a magnet", () => {
  const [, second] = parseTorznab(FEED);
  assert.ok(second.magnet?.startsWith("magnet:?xt=urn:btih:bbbbccccdddd"));
});

test("a hash in the details URL is enough to build a magnet", () => {
  // TorrentDownload and LimeTorrents send neither magneturl nor infohash, and
  // offer the download only as Jackett's own link — which embeds the API key
  // and so never reaches the browser. Without this the release arrives with
  // nothing to fetch it by and the row draws empty.
  const [result] = parseTorznab(`
    <item>
      <title>Inception 2010 1080p AV1 10Bit DKong</title>
      <guid>https://www.torrentdownload.info/520F5BB299060C2CD62192E602F1C2157E9D277F/Inception-2010</guid>
    </item>
  `);
  assert.equal(result.infoHash, "520f5bb299060c2cd62192e602f1c2157e9d277f");
  assert.ok(
    result.magnet?.startsWith(
      "magnet:?xt=urn:btih:520f5bb299060c2cd62192e602f1c2157e9d277f",
    ),
  );
});

test("a v2 hash in a URL is not mistaken for a v1 one", () => {
  // 64 hex characters is a v2 info hash, which is not a btih — taking forty of
  // them would build a magnet that resolves to nothing at all.
  const [result] = parseTorznab(`
    <item>
      <title>Some Release 2024</title>
      <guid>https://example.org/a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90/x</guid>
    </item>
  `);
  assert.equal(result.infoHash, undefined);
  assert.equal(result.magnet, undefined);
});

test("a real infohash attribute still wins over the URL", () => {
  const [result] = parseTorznab(`
    <item>
      <title>Some Release 2024</title>
      <guid>https://example.org/520F5BB299060C2CD62192E602F1C2157E9D277F/x</guid>
      <torznab:attr name="infohash" value="AAAABBBBCCCCDDDDEEEEFFFF0000111122223333" />
    </item>
  `);
  assert.equal(result.infoHash, "aaaabbbbccccddddeeeeffff0000111122223333");
});

test("a CDATA title comes through unwrapped", () => {
  const [, second] = parseTorznab(FEED);
  assert.equal(second.title, "Heat.1995.1080p.BluRay.x264.DTS-HD.MA.5.1-GRP");
});

test("a guid that is not a URL is not offered as a link", () => {
  // Some indexers use an opaque id there, and rendering it as a link gives a
  // Details button that goes nowhere.
  const [first, second] = parseTorznab(FEED);
  assert.equal(first.detailsUrl, "https://example.org/details/1");
  assert.equal(second.detailsUrl, undefined);
});

test("categories are numbers, and all of them", () => {
  assert.deepEqual(parseTorznab(FEED)[0].categories, [2045, 2000]);
});

test("the indexer name is kept, so a result can say where it came from", () => {
  assert.equal(parseTorznab(FEED)[0].indexer, "Example Tracker");
});

test("a missing seeder count is undefined rather than zero", () => {
  // Zero seeders is a real and useful fact; not knowing is a different one,
  // and showing "0 seeders" for the second would be a lie about the release.
  const xml = `<rss><channel><item><title>X.2020.1080p</title></item></channel></rss>`;
  assert.equal(parseTorznab(xml)[0].seeders, undefined);
});

test("an empty feed parses to nothing rather than throwing", () => {
  assert.deepEqual(parseTorznab("<rss><channel></channel></rss>"), []);
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

test("Jackett's error element is surfaced", () => {
  // Returned with a 200 status as often as not, which is why it is looked for
  // in the body rather than inferred from the response code.
  const xml = `<?xml version="1.0"?><error code="100" description="Incorrect user credentials" />`;
  assert.equal(feedError(xml), "Incorrect user credentials");
  assert.equal(feedError(FEED), undefined);
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/** What Jackett's `all` feed returns when its indexers are the capable sort. */
const FULL_CAPS = `<?xml version="1.0" encoding="utf-8"?>
<caps>
  <server title="Jackett" />
  <limits max="100" default="100" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep" />
    <movie-search available="yes" supportedParams="q,imdbid" />
    <music-search available="no" supportedParams="q" />
  </searching>
  <categories>
    <category id="2000" name="Movies"><subcat id="2045" name="Movies/UHD" /></category>
    <category id="5000" name="TV" />
  </categories>
</caps>`;

/** What a stack of basic public indexers returns — search, and nothing else. */
const BASIC_CAPS = `<?xml version="1.0" encoding="utf-8"?>
<caps>
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="no" supportedParams="q" />
    <movie-search available="no" supportedParams="q" />
  </searching>
  <categories><category id="2000" name="Movies" /></categories>
</caps>`;

test("a capable feed advertises all three modes with their parameters", () => {
  const caps = parseCaps(FULL_CAPS);
  assert.equal(caps.search.available, true);
  assert.equal(caps.movie.available, true);
  assert.deepEqual(caps.movie.params, ["q", "imdbid"]);
  assert.deepEqual(caps.tv.params, ["q", "season", "ep"]);
});

test("movie-search is not mistaken for the basic search element", () => {
  // `<search` must not match inside `<movie-search`, or a feed offering only
  // movie search would look like it offers basic search too.
  const caps = parseCaps(
    `<caps><searching><movie-search available="yes" supportedParams="q,imdbid" /></searching></caps>`,
  );
  assert.equal(caps.movie.available, true);
  assert.equal(caps.search.available, false);
});

test("indexers that offer only basic search are read as such", () => {
  // This is the case that produced "all does not support the requested query":
  // asking for t=movie here is refused outright by the aggregate.
  const caps = parseCaps(BASIC_CAPS);
  assert.equal(caps.search.available, true);
  assert.equal(caps.movie.available, false);
  assert.equal(caps.tv.available, false);
});

test("subcategories are counted alongside categories", () => {
  assert.deepEqual(parseCaps(FULL_CAPS).categories, [2000, 2045, 5000]);
});

test("caps with no searching block claim nothing", () => {
  const caps = parseCaps("<caps><categories /></caps>");
  assert.equal(caps.search.available, false);
  assert.equal(caps.movie.available, false);
  assert.deepEqual(caps.categories, []);
});

// ---------------------------------------------------------------------------
// Trackers
// ---------------------------------------------------------------------------

/** A result carrying only what the tracker pooling actually reads. */
const listing = (
  indexer: string,
  infoHash: string | undefined,
  magnet: string | undefined,
): IndexerResult => ({
  title: "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-FraMeSToR",
  indexer,
  infoHash,
  magnet,
  categories: [2045],
});

const OPEN = "udp://tracker.opentrackr.org:1337/announce";
const TORRENT = "udp://open.demonii.com:1337/announce";

test("a magnet's own trackers are read back out of it", () => {
  assert.deepEqual(
    trackersOf(
      `magnet:?xt=urn:btih:AAAA&tr=${encodeURIComponent(OPEN)}&tr=${encodeURIComponent(TORRENT)}`,
    ),
    [OPEN, TORRENT],
  );
});

test("a magnet with no trackers, and a string that is not one, read as none", () => {
  assert.deepEqual(trackersOf("magnet:?xt=urn:btih:AAAA"), []);
  assert.deepEqual(trackersOf(undefined), []);
  assert.deepEqual(trackersOf("not a magnet at all"), []);
});

test("adding trackers leaves the parameters already there untouched", () => {
  // The reason this appends text rather than rebuilding through `URL`: the
  // serialiser would re-encode `xt` as `urn%3Abtih%3A...`, which some clients
  // will not read.
  const merged = withTrackers("magnet:?xt=urn:btih:AAAA&dn=Dune", [OPEN]);
  assert.ok(merged.startsWith("magnet:?xt=urn:btih:AAAA&dn=Dune"));
  assert.deepEqual(trackersOf(merged), [OPEN]);
});

test("a tracker a magnet already announces to is not added twice", () => {
  const magnet = `magnet:?xt=urn:btih:AAAA&tr=${encodeURIComponent(OPEN)}`;
  assert.equal(withTrackers(magnet, [OPEN]), magnet);
  assert.deepEqual(trackersOf(withTrackers(magnet, [OPEN, TORRENT])), [
    OPEN,
    TORRENT,
  ]);
});

test("copies of one release pool the trackers each indexer published", () => {
  const [first, second] = shareTrackers([
    listing("A", "aaaa", `magnet:?xt=urn:btih:AAAA&tr=${encodeURIComponent(OPEN)}`),
    listing("B", "aaaa", `magnet:?xt=urn:btih:AAAA&tr=${encodeURIComponent(TORRENT)}`),
  ]);

  assert.deepEqual(trackersOf(first.magnet), [OPEN, TORRENT]);
  assert.deepEqual(trackersOf(second.magnet), [TORRENT, OPEN]);
});

test("an indexer that published only a hash gains the others' trackers", () => {
  // The case this is for: `parseTorznab` builds a magnet for these, and it has
  // no trackers on it at all, so the swarm is only reachable over DHT.
  const [hashOnly] = shareTrackers([
    listing("hash-only", "aaaa", "magnet:?xt=urn:btih:AAAA&dn=Dune"),
    listing("A", "aaaa", `magnet:?xt=urn:btih:AAAA&tr=${encodeURIComponent(OPEN)}`),
  ]);

  assert.deepEqual(trackersOf(hashOnly.magnet), [OPEN]);
});

test("trackers are never pooled across two different info hashes", () => {
  // A re-upload under the same name is a different swarm, and these trackers
  // have never been told about it.
  const [reupload] = shareTrackers([
    listing("A", "bbbb", "magnet:?xt=urn:btih:BBBB"),
    listing("B", "aaaa", `magnet:?xt=urn:btih:AAAA&tr=${encodeURIComponent(OPEN)}`),
  ]);

  assert.deepEqual(trackersOf(reupload.magnet), []);
});

test("a result with no hash and no magnet survives pooling unchanged", () => {
  const results = [listing("A", undefined, undefined)];
  assert.deepEqual(shareTrackers(results), results);
});
