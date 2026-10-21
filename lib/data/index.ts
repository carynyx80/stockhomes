/**
 * The only place that decides where data comes from.
 *   NEXT_PUBLIC_DATA_SOURCE=simulated (default): mock feeds and paper balances.
 *   NEXT_PUBLIC_DATA_SOURCE=testnet: the Stoxhomes contracts on Robinhood Chain testnet, via the visitor's wallet.
 * Nothing in the UI changes between them.
 */
import { EXCHANGE } from "@/config/exchange";
import { createLiveSource } from "./live";
import { createSimulatedSource } from "./simulated";
import type { DataSource } from "./types";

const choice = process.env.NEXT_PUBLIC_DATA_SOURCE;

export const data: DataSource =
  choice === "testnet" && EXCHANGE.testnet
    ? createLiveSource(EXCHANGE.testnet, "testnet", process.env.NEXT_PUBLIC_RPC_URL_TESTNET)
    : createSimulatedSource();

export type * from "./types";
