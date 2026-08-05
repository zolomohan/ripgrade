import { getConvertJob } from "@/lib/convert";
import { getDoviJob } from "@/lib/dovi";
import { subscribeJobs, type JobsSnapshot } from "@/lib/job-events";
import { getScanState } from "@/lib/scanner";

/**
 * One SSE stream carrying all three background jobs, instead of the four
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

export function GET(request: Request) {
  const encoder = new TextEncoder();

  // Read at send time, not captured: the getters go through globalThis, so a
  // snapshot taken after a coalesced burst reports the burst's final state.
  const snapshot = (): JobsSnapshot => ({
    scan: getScanState(),
    dovi: getDoviJob(),
    convert: getConvertJob(),
  });

  const stream = new ReadableStream({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The client went away between the abort firing and this send.
        }
      };
      const send = () => write(`data: ${JSON.stringify(snapshot())}\n\n`);

      // The connect-time state first, so a page opened mid-job renders the
      // job immediately rather than waiting for its next change.
      send();
      const unsubscribe = subscribeJobs(send);
      const heartbeat = setInterval(() => write(":\n\n"), HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the disconnect itself.
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
