"use server";

import { refresh } from "next/cache";
import { stat } from "node:fs/promises";
import path from "node:path";

import { listDirectory, type DirListing } from "@/lib/browse";
import { getSetting, setSetting } from "@/lib/db";
import { getScanState, startScan, type ScanState } from "@/lib/scanner";

// Not exported: a "use server" module may only export async functions.
const LIBRARY_ROOT_KEY = "libraryRoot";

export async function browse(target: string): Promise<DirListing> {
  return listDirectory(target);
}

export async function getLibraryRoot(): Promise<string | undefined> {
  return getSetting(LIBRARY_ROOT_KEY);
}

export async function setLibraryRoot(
  target: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = path.resolve(target);

  try {
    if (!(await stat(resolved)).isDirectory()) {
      return { ok: false, error: `Not a directory: ${resolved}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  setSetting(LIBRARY_ROOT_KEY, resolved);
  refresh();
  return { ok: true };
}

export async function beginScan(): Promise<ScanState> {
  const root = getSetting(LIBRARY_ROOT_KEY);
  if (!root) {
    return {
      status: "error",
      discovered: 0,
      probed: 0,
      cached: 0,
      failed: 0,
      error: "No library folder selected.",
    };
  }
  return startScan(root);
}

export async function scanStatus(): Promise<ScanState> {
  return getScanState();
}
