import type { Obligation, RunRecord, StorePort } from "./types";

/** In-memory StorePort with the same compare-and-set and uniqueness rules as Postgres. For tests. */
export function memoryStore(): StorePort & { all(): Obligation[]; runs: RunRecord[]; cursor: bigint | null } {
  const rows: Obligation[] = [];
  const state = { cursor: null as bigint | null, runs: [] as RunRecord[] };
  let nextId = 1;
  return {
    async addObligation(o) {
      if (rows.some((r) => r.sourceTx === o.sourceTx)) return false;
      rows.push({ ...o, id: nextId++, attempts: 0, createdAt: new Date() });
      return true;
    },
    async openObligations() {
      return rows.filter((r) => r.state !== "burned").map((r) => ({ ...r }));
    },
    async transition(id, from, patch) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.state !== from) return false;
      Object.assign(r, patch);
      return true;
    },
    async noteError(id, error) {
      const r = rows.find((x) => x.id === id);
      if (r) r.lastError = error;
    },
    async getCursor() {
      return state.cursor;
    },
    async setCursor(b) {
      state.cursor = b;
    },
    async recordRun(run) {
      state.runs.push(run);
    },
    all: () => rows.map((r) => ({ ...r })),
    get runs() {
      return state.runs;
    },
    get cursor() {
      return state.cursor;
    },
  };
}
