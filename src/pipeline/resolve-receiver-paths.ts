import { cju } from "@tscircuit/circuit-json-util"
import { endpointPorts, type ReceiverTracePath } from "../board"
import {
  extractedNonrailSourceTraceIds,
  receiverGraphs,
  receiverPath,
  type TraceContacts,
} from "../simulation"
import { fail } from "./diagnostics"
import type { PreparedChannelSimulation } from "./signals"

/** Resolve each declared receiver to its ordered routed trace path. */
export function resolveReceiverTracePaths({
  prepared,
  cuts,
}: {
  prepared: PreparedChannelSimulation
  cuts: readonly TraceContacts[]
}): ReceiverTracePath[] {
  const { circuit, settings, driverReceiverChannels } = prepared
  const db = cju([...circuit])
  const graphs = receiverGraphs({
    db,
    circuit,
    groundSourcePortId: settings.channelReference.sourcePortId,
    modeling: settings,
    cuts,
    additionalSourceTraceIds: extractedNonrailSourceTraceIds({
      db,
      copperScope: settings.copperScope,
    }),
    channels: driverReceiverChannels,
  })
  const receiverPaths: ReceiverTracePath[] = []
  for (const { name, driver, receivers } of prepared.driverReceiverChannels) {
    const driverPorts = endpointPorts(driver)
    for (const receiver of receivers) {
      for (const [leg, toSourcePortId] of endpointPorts(receiver).entries()) {
        const fromSourcePortId = driverPorts[leg]
        const path = receiverPath({
          graphs,
          fromSourcePortId,
          toSourcePortId,
          allowUnroutedTraces:
            prepared.channelSimulation.allow_unrouted_traces === true,
        })
        if (!path)
          return fail(
            "channel_net",
            `${name}: no source path from ${fromSourcePortId} to ${toSourcePortId}`,
            {
              subjects: [fromSourcePortId, toSourcePortId].map((id) => ({
                kind: "record",
                id,
              })),
            },
          )
        const sourceTraceIds = path.flatMap((edge) => {
          if (edge.sourceTraceId !== undefined) return [edge.sourceTraceId]
          return []
        })
        const [sourceTraceId] = sourceTraceIds
        if (sourceTraceId === undefined) continue
        const receiverPathRecord: ReceiverTracePath = {
          channelName: name,
          fromSourcePortId,
          toSourcePortId,
          sourceTraceId,
        }
        if (sourceTraceIds.length > 1)
          receiverPaths.push({ ...receiverPathRecord, sourceTraceIds })
        else receiverPaths.push(receiverPathRecord)
      }
    }
  }
  return receiverPaths
}
