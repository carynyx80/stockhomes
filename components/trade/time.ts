import type { HistoryRange } from "@/lib/data";

const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayHm = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function timeFormatter(range: HistoryRange, detailed = false): (t: number) => string {
  if (range === "1D") return (t) => hm.format(t);
  if (range === "1W") return (t) => dayHm.format(t);
  return (t) => (detailed ? full : dayMonth).format(t);
}

export const RANGES: HistoryRange[] = ["1D", "1W", "1M", "6M", "1Y"];
