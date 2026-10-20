/**
 * The dev server compiles each route on first request, and the Open House replays 12 simulated hours on first use.
 * Do both once, before the parallel workers start, so no test spends its timeout waiting on a cold server.
 */
const ROUTES = ["/", "/trade", "/vault", "/wars", "/burn", "/docs", "/house", "/house/miami-bull", "/api/house", "/api/house/miami-bull", "/api/burns"];

export default async function globalSetup() {
  const base = `http://localhost:${process.env.E2E_PORT ?? 3200}`;
  for (const path of ROUTES) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(base + path).catch(() => null);
      if (res && res.status < 500) break;
    }
  }
}
