import { GEO } from "@/config/stoxhomes";

export function isRestrictedRoute(pathname: string): boolean {
  return GEO.restrictedRoutes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Decides whether a visitor may see a trading page.
 * `country` and `region` come from Vercel's geo headers; both are null when running elsewhere.
 */
export function isBlocked(country: string | null, region: string | null, production: boolean): boolean {
  if (!country) return production && GEO.failClosedInProduction;
  const c = country.toUpperCase();
  if ((GEO.blockedCountries as readonly string[]).includes(c)) return true;
  const regions = GEO.blockedRegions[c];
  return Boolean(region && regions?.includes(region.toUpperCase()));
}
