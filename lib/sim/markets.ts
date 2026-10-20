export type Market = {
  id: string;
  city: string;
  country: string;
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

export function marketById(id: string): Market {
  const m = MARKETS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown market ${id}`);
  return m;
}
