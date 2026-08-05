"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { JobsSnapshot } from "@/lib/job-events";

/**
 * The client end of `/api/jobs` — one EventSource for the whole app, owned
 * here in the root layout so it survives navigation the way the scan state
 * always has.
 *
 * Everything below reads jobs from this context instead of polling:
 * `ScanProvider` for the scan, `SidebarProcesses` for the rail, the film
 * page for its own conversion and full pass. The server pushes a whole
 * `JobsSnapshot` whenever anything changes, so there is no interval to tune
 * and an idle app sends nothing at all.
 */

type JobsListener = (next: JobsSnapshot, prev: JobsSnapshot) => void;

type JobsContext = {
  jobs: JobsSnapshot;
  /**
   * Overwrites part of the snapshot from an action's return value — a start
   * or stop knows the new state before the stream's next event, and waiting
   * for it would leave the button looking pressed and ignored.
   */
  apply: (patch: Partial<JobsSnapshot>) => void;
  /**
   * Called on every stream event with the new and previous snapshots, from
   * the stream's own callback rather than a render. Completion is an edge —
   * running a moment ago, finished now — and the server cannot express that:
   * it reports "done" forever after, so a connect-time snapshot looks
   * identical to a fresh finish. Only someone holding the previous snapshot
   * can tell them apart. Returns the unsubscribe.
   */
  subscribe: (listener: JobsListener) => () => void;
};

const Ctx = createContext<JobsContext | null>(null);

export function useJobs(): JobsContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJobs must be used inside JobsProvider");
  return ctx;
}

export function JobsProvider({
  initial,
  children,
}: {
  /** Server-rendered state, so a reload mid-job shows progress immediately. */
  initial: JobsSnapshot;
  children: React.ReactNode;
}) {
  const [jobs, setJobs] = useState(initial);
  // The same snapshot, readable without a render: `prev` for edge detection.
  const jobsRef = useRef(initial);
  const listenersRef = useRef<Set<JobsListener>>(new Set());

  useEffect(() => {
    // EventSource reconnects on its own — a dev reload or dropped connection
    // costs one connect, and the first event after it is a full snapshot.
    const source = new EventSource("/api/jobs");
    source.onmessage = (event) => {
      const next = JSON.parse(event.data) as JobsSnapshot;
      const prev = jobsRef.current;
      jobsRef.current = next;
      setJobs(next);
      for (const listener of listenersRef.current) listener(next, prev);
    };
    return () => source.close();
  }, []);

  // Feeds the ref as well, so a job we optimistically know is running counts
  // as the "previous" state when the stream reports how it ended — otherwise
  // a start followed by a quick failure would not read as an edge at all.
  const apply = useCallback((patch: Partial<JobsSnapshot>) => {
    jobsRef.current = { ...jobsRef.current, ...patch };
    setJobs(jobsRef.current);
  }, []);

  const subscribe = useCallback((listener: JobsListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return (
    <Ctx.Provider value={{ jobs, apply, subscribe }}>{children}</Ctx.Provider>
  );
}
