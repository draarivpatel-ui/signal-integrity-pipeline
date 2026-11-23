import { circuitJsonDb, endpointPorts, type LaneMapping } from "../board"
import {
  extractedNonrailSourceTraceIds,
  type RoutedTraceCut,
  receiverGraphs,
  receiverPath,
} from "../simulation"
import { fail } from "./diagnostics"
import type { PreparedChannelSimulation } from "./signals"

/** Resolve each declared receiver to its ordered routed trace path. */
export function routedReceiverMappings({
  prepared,
  cuts,
}: {
  prepared: PreparedChannelSimulation
  cuts: readonly RoutedTraceCut[]
}): LaneMapping[] {
  const { circuit, settings, driverReceiverChannels } = prepared
  const db = circuitJsonDb(circuit)
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
  const mappings: LaneMapping[] = []
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
          )
        const sourceTraceIds = path.flatMap((edge) => {
          if ("sourceTraceId" in edge) return [edge.sourceTraceId]
          return []
        })
        const [sourceTraceId] = sourceTraceIds
        if (sourceTraceId === undefined) continue
        const mapping: LaneMapping = {
          port: name,
          from: fromSourcePortId,
          to: toSourcePortId,
          sourceTraceId,
        }
        if (sourceTraceIds.length > 1)
          mappings.push({ ...mapping, sourceTraceIds })
        else mappings.push(mapping)
      }
    }
  }
  return mappings
}
