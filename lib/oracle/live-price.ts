import type { OracleMarket } from "@/config/oracle";
import { noiseAt } from "./noise";
import { marketPriceAt, type Observation } from "./price";

/** The price the keeper posts: the index path, plus testnet live movement when a seed is given. */
export function livePriceAt(m: OracleMarket, obs: Observation[], t: number, seed?: string): number {
  const base = marketPriceAt(m, obs, t);
  return seed ? base * Math.exp(noiseAt(seed, m.id, t)) : base;
}
