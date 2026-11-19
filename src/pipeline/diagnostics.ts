import { diagnostics } from "../kernel"
export const fail = diagnostics("pipeline", [
  "channel_fanout",
  "channel_net",
] as const)
