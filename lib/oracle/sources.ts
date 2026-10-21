import type { MonthlySource } from "@/config/oracle";
import type { Observation } from "./price";

/** S&P CoreLogic Case-Shiller via FRED's public CSV (no key). Format: "observation_date,SERIES\nYYYY-MM-DD,value". */
export async function fetchFred(series: string, fetchImpl: typeof fetch = fetch): Promise<Observation[]> {
  const res = await fetchImpl(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}`);
  if (!res.ok) throw new Error(`FRED ${series}: HTTP ${res.status}`);
  return parseFredCsv(await res.text());
}

export function parseFredCsv(csv: string): Observation[] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && v !== "." && v !== "")
    .map(([d, v]) => ({ month: d.slice(0, 7), value: Number(v) }));
}

/** UK House Price Index (HM Land Registry, Open Government Licence) via its public SPARQL endpoint. */
export async function fetchUkHpi(region: string, fetchImpl: typeof fetch = fetch): Promise<Observation[]> {
  if (!/^[a-z-]+$/.test(region)) throw new Error("bad region");
  const query = `PREFIX ukhpi: <http://landregistry.data.gov.uk/def/ukhpi/>
SELECT ?month ?hpi WHERE {
  ?obs ukhpi:refRegion <http://landregistry.data.gov.uk/id/region/${region}> ;
       ukhpi:refMonth ?month ;
       ukhpi:housePriceIndex ?hpi .
  FILTER (?month >= "2023-01"^^<http://www.w3.org/2001/XMLSchema#gYearMonth>)
} ORDER BY ?month`;
  const res = await fetchImpl("https://landregistry.data.gov.uk/landregistry/sparql", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/sparql-results+json" },
    body: new URLSearchParams({ query }).toString(),
  });
  if (!res.ok) throw new Error(`UK HPI ${region}: HTTP ${res.status}`);
  const body = (await res.json()) as { results: { bindings: { month: { value: string }; hpi: { value: string } }[] } };
  return body.results.bindings.map((b) => ({ month: b.month.value.slice(0, 7), value: Number(b.hpi.value) }));
}

export function fetchSource(source: MonthlySource, fetchImpl: typeof fetch = fetch): Promise<Observation[]> {
  return source.kind === "fred" ? fetchFred(source.series, fetchImpl) : fetchUkHpi(source.region, fetchImpl);
}
