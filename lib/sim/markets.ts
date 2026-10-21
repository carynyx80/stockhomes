import { CATALOGUE } from "@/config/markets";

export type Market = {
  id: string;
  city: string;
  country: string;
  /** US state or UK nation, for exchange markets. */
  region?: string;
  /** Simulated index level at genesis, in USD (roughly a typical home price). */
  base: number;
  /** Mean daily log-return, to give each city a gentle character. */
  drift: number;
};

export const MARKETS: readonly Market[] = [
  { id: "nyc", city: "New York", country: "United States", base: 782_000, drift: 0.00008 },
  { id: "mia", city: "Miami", country: "United States", base: 594_000, drift: 0.00014 },
  { id: "lax", city: "Los Angeles", country: "United States", base: 961_000, drift: 0.00005 },
  { id: "lon", city: "London", country: "United Kingdom", base: 521_000, drift: -0.00002 },
  { id: "dxb", city: "Dubai", country: "United Arab Emirates", base: 413_000, drift: 0.00022 },
  { id: "los", city: "Lagos", country: "Nigeria", base: 146_000, drift: 0.00018 },
];

/** The on-chain exchange's city markets (config/markets.generated.ts). */
export const EXCHANGE_MARKETS: readonly Market[] = CATALOGUE.map((m) => ({ id: m.id, city: m.city, country: m.country, region: m.region, base: m.base, drift: 0 }));

export function marketById(id: string): Market {
  const m = MARKETS.find((x) => x.id === id) ?? EXCHANGE_MARKETS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown market ${id}`);
  return m;
}
