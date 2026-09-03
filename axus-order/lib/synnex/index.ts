// lib/synnex/index.ts
// Adapter factory. Chooses the mock or the real TD SYNNEX REST adapter from env.
//
//   SYNNEX_ADAPTER=mock   -> MockSynnexAdapter (default; no keys needed)
//   SYNNEX_ADAPTER=real   -> RestSynnexAdapter (needs SYNNEX_CLIENT_ID/SECRET)
//
// Defaulting to the mock means the app runs end-to-end with zero TD SYNNEX
// credentials. To go live, set SYNNEX_ADAPTER=real and add the sandbox keys.
import type { SynnexAdapter } from "./adapter";
import { RestSynnexAdapter } from "./adapter";
import { MockSynnexAdapter } from "./mock";

export function getAdapter(): SynnexAdapter {
  const mode = (process.env.SYNNEX_ADAPTER ?? "mock").toLowerCase();
  if (mode === "real") return new RestSynnexAdapter();
  return new MockSynnexAdapter();
}

export type { SynnexAdapter };
