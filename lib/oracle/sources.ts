import type { OracleMarket } from "@/config/oracle";
import type { Observation } from "./price";

export const ZILLOW_METRO_CSV = "https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv";
const UK_SPARQL = "https://landregistry.data.gov.uk/landregistry/sparql";
/** Readings from here on are enough for every chart range and the glide path. */
const FROM_MONTH = "2024-01";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Zillow's metro ZHVI CSV: "RegionID,SizeRank,RegionName,RegionType,StateName,2000-01-31,…" with one row per metro.
 * Returns readings per RegionID, for the wanted ids only.
 */
export function parseZillowCsv(csv: string, wanted: Set<number>): Record<number, Observation[]> {
  const lines = csv.trim().split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const cols = header.map((h, i) => ({ i, month: h.slice(0, 7) })).filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(header[c.i]) && c.month >= FROM_MONTH);
  const out: Record<number, Observation[]> = {};
  for (const line of lines.slice(1)) {
    const id = Number(line.slice(0, line.indexOf(",")));
    if (!wanted.has(id)) continue;
    const row = splitCsvLine(line);
    out[id] = cols.filter((c) => row[c.i] !== "" && row[c.i] !== undefined).map((c) => ({ month: c.month, value: Number(row[c.i]) }));
  }
  return out;
}

export async function fetchZillow(regionIds: number[], fetchImpl: typeof fetch = fetch): Promise<Record<number, Observation[]>> {
  const res = await fetchImpl(ZILLOW_METRO_CSV);
  if (!res.ok) throw new Error(`Zillow ZHVI: HTTP ${res.status}`);
  return parseZillowCsv(await res.text(), new Set(regionIds));
}

/** UK House Price Index average prices (GBP) for many regions in one SPARQL query. */
export async function fetchUkHpi(regions: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, Observation[]>> {
  for (const r of regions) if (!/^[a-z-]+$/.test(r)) throw new Error("bad region");
  const query = `PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
SELECT ?r ?month ?p WHERE {
  VALUES ?r { ${regions.map((r) => `"${r}"`).join(" ")} }
  BIND(IRI(CONCAT("http://landregistry.data.gov.uk/id/region/", ?r)) AS ?region)
  ?obs ukhpi:refRegion ?region ; ukhpi:refMonth ?month ; ukhpi:averagePrice ?p .
  FILTER (?month >= "${FROM_MONTH}"^^<http://www.w3.org/2001/XMLSchema#gYearMonth>)
}`;
  const res = await fetchImpl(UK_SPARQL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }).toString(),
  });
  if (!res.ok) throw new Error(`UK HPI: HTTP ${res.status}`);
  const body = (await res.json()) as { results: { bindings: { r: { value: string }; month: { value: string }; p: { value: string } }[] } };
  const out: Record<string, Observation[]> = {};
  for (const b of body.results.bindings) (out[b.r.value] ??= []).push({ month: b.month.value.slice(0, 7), value: Number(b.p.value) });
  return out;
}

/**
 * Readings for every market, keyed by market id. Each source is fetched once (one CSV, one query) and
 * independently, so one failing source only leaves its own markets out.
 */
export async function fetchAllObservations(markets: OracleMarket[], fetchImpl: typeof fetch = fetch): Promise<Record<string, Observation[]>> {
  const zillowIds = markets.flatMap((m) => (m.source.kind === "zillow" ? [m.source.regionId] : []));
  const ukRegions = markets.flatMap((m) => (m.source.kind === "ukhpi" ? [m.source.region] : []));
  const retry = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch {
      return await fn();
    }
  };
  const [zillow, uk] = await Promise.allSettled([
    zillowIds.length ? retry(() => fetchZillow(zillowIds, fetchImpl)) : Promise.resolve({} as Record<number, Observation[]>),
    ukRegions.length ? retry(() => fetchUkHpi(ukRegions, fetchImpl)) : Promise.resolve({} as Record<string, Observation[]>),
  ]);
  const out: Record<string, Observation[]> = {};
  for (const m of markets) {
    const obs =
      m.source.kind === "zillow"
        ? zillow.status === "fulfilled" ? zillow.value[m.source.regionId] : undefined
        : uk.status === "fulfilled" ? uk.value[m.source.region] : undefined;
    if (obs?.length) out[m.id] = obs;
  }
  return out;
}
