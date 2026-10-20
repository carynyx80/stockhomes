/**
 * The only place that decides where data comes from. To go live, replace the line below with the
 * oracle/contract-backed implementation of DataSource; nothing in the UI changes.
 */
import { createSimulatedSource } from "./simulated";
import type { DataSource } from "./types";

export const data: DataSource = createSimulatedSource();

export type * from "./types";
