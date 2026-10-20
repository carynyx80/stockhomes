"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { data, type HistoryRange, type PricePoint, type Snapshot } from "./index";

/** Live snapshot. `null` during server render and the first client paint (paper state lives in the browser). */
export function useSnapshot(): Snapshot | null {
  return useSyncExternalStore(data.subscribe, data.getSnapshot, () => null);
}

type Loader = (range: HistoryRange) => Promise<PricePoint[]>;

/** Loads a history series and refreshes it every `refreshMs`. Keeps the previous series while reloading. */
export function useHistory(key: string, load: Loader, range: HistoryRange, refreshMs = 30_000) {
  const [points, setPoints] = useState<PricePoint[] | null>(null);
  useEffect(() => {
    let live = true;
    const run = () => load(range).then((p) => live && setPoints(p));
    run();
    const id = setInterval(run, refreshMs);
    return () => {
      live = false;
      clearInterval(id);
    };
    // `load` is identified by `key`, so callers can pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range, refreshMs]);
  return points;
}
