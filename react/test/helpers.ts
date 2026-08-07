import { FundflowClient, VenlyFinanceClient } from "@venlyfinance/sdk";
import type { VenlyClients } from "../src/provider.js";

/** Fresh mock-mode client pair: zero credentials, zero network, seeded store. */
export function mockClients(): VenlyClients {
  return {
    environment: "mock",
    finance: new VenlyFinanceClient({ environment: "mock" }),
    fundflow: new FundflowClient({ environment: "mock" }),
  };
}

export function waitFor(
  predicate: () => boolean,
  { timeoutMs = 5_000, intervalMs = 5 } = {},
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error("waitFor: condition not met in time"));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
