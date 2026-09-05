import { getStripJob } from "@/lib/audio-strip";
import { getConvertJob } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { getDoviRun } from "@/lib/dovi-run";
import { subscribeJobs, type JobsSnapshot } from "@/lib/job-events";
import { getScanState } from "@/lib/scanner";
import { getThumbJob } from "@/lib/thumbs";
import { getSweepJob } from "@/lib/upgrade-sweep";

/**
 * One SSE stream carrying every background job, instead of the four
 * polling intervals the client used to run. Each event is a full
 * `JobsSnapshot` rather than a delta, so a reconnect (dev reload, dropped
 * connection — EventSource retries by itself) needs no catch-up protocol:
 * the first event after connecting is always the whole truth.
 *
 * The connection stays open while the tab does. An idle stream costs nothing
 * but the socket — unlike the old idle poll, which asked the server a
 * question every three seconds forever.
 */

/** A comment line, to keep an idle connection from being reaped as dead. */
const HEARTBEAT_MS = 30_000;

/**
 * How many unsent events a connection may bank before it is treated as gone.
 *
 * A live client drains this stream as fast as the socket allows, so the queue
 * behind it is empty or one deep. A backlog means the far end has stopped
 * reading — and the far end is not always polite about saying so: a laptop put
 * to sleep, a network that changed underneath the tab, a browser that froze a
 * background page all leave a socket that is dead without ever sending the
 * close that fires `request.signal`. Nothing then cleared the subscription or
 * the heartbeat, and every job change went on being serialised into a queue
 * with no reader — a full snapshot, output lines and all, four times a second
 * for as long as the server ran.
 *
 * A number rather than a time because that is what a queuing strategy counts.
 * At the fastest the events coalesce to it is a quarter of a minute of a
 * client that has not read one byte, which no working connection does.
 */
const BACKLOG = 64;

export function GET(request: Request) {
  const encoder = new TextEncoder();

  // Read at send time, not captured: the getters go through globalThis, so a
  // snapshot taken after a coalesced burst reports the burst's final state.
  const snapshot = (): JobsSnapshot => ({
    scan: getScanState(),
    dovi: getDoviJob(),
    convert: getConvertJob(),
    strip: getStripJob(),
    sweep: getSweepJob(),
    thumbs: getThumbJob(),
    dvRun: getDoviRun(),
  });

  // Assigned by `start` below, and called from `cancel` as well — a consumer
  // that lets go of the stream is the other way this ends, and it does not
  // always come with an abort.
  let teardown = () => {};

  const stream = new ReadableStream(
    {
      start(controller) {
        let closed = false;

        const write = (text: string) => {
          if (closed) return;

          // Nobody is reading. Said by the queue rather than by an error,
          // because a socket that has stopped draining raises none — see
          // `BACKLOG`.
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            close();
            return;
          }

          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // The client went away between the abort firing and this send.
            close();
          }
        };
        const send = () => write(`data: ${JSON.stringify(snapshot())}\n\n`);

        const unsubscribe = subscribeJobs(send);
        const heartbeat = setInterval(() => write(":\n\n"), HEARTBEAT_MS);

        // Everything this connection holds, let go of exactly once however it
        // ends: the client disconnecting, the stream being cancelled, or a
        // send that proves nobody is there any more. Declared after the two it
        // releases and used before it by `write`, which cannot run until the
        // send at the foot of this function.
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // Already closed by the disconnect itself.
          }
        };
        teardown = close;

        request.signal.addEventListener("abort", close);

        // The connect-time state, so a page opened mid-job renders the job
        // immediately rather than waiting for its next change. Last, because
        // it is also the first send that could find the connection already
        // gone, and there is nothing to tear down until the lines above ran.
        send();
      },
      cancel() {
        teardown();
      },
    },
    new CountQueuingStrategy({ highWaterMark: BACKLOG }),
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
