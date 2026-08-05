"use client";

import { createContext, useContext } from "react";

/**
 * What the install can do, read once in the root layout and available to any
 * client component without threading a prop through every page in between.
 * Currently one fact; the shape is a record so the next one is a field, not
 * a refactor.
 */
type Capabilities = {
  /** qBittorrent is connected, so download buttons hand over instead of
      opening a magnet handler. */
  qb: boolean;
};

const Ctx = createContext<Capabilities>({ qb: false });

export const useCapabilities = () => useContext(Ctx);

export function CapabilitiesProvider({
  qb,
  children,
}: Capabilities & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ qb }}>{children}</Ctx.Provider>;
}
