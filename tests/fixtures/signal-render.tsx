import type React from "react"
import type { CircuitJson } from "../../src/board"
import type { IbisSources } from "../../src/buffers"
import { RoutedAdmissionSolver } from "../../src/pipeline"
import {
  listChannelSimulations,
  type PreparedChannelSimulation,
  prepareChannelSimulationById,
} from "../../src/pipeline/signals"
import type { RouteBindingsInput } from "../../src/simulation"
import { renderCoreSignals } from "../support/core-render"

/** Render through real core, permitting only specifically expected physical diagnostics. */
export async function renderSignals({
  tree,
  expectedErrors = [],
}: {
  tree: React.ReactElement
  expectedErrors?: string[]
}): Promise<CircuitJson> {
  try {
    return await renderCoreSignals(tree)
  } catch (error) {
    const records = (error as { circuitJson?: CircuitJson }).circuitJson
    if (
      !records?.some(
        (record) => record.type === "simulation_pcb_driver_receiver_channel",
      )
    )
      throw error
    const errors = records.filter((record) => record.type.endsWith("_error"))
    if (
      errors.length > 0 &&
      errors.every((record) => expectedErrors.includes(record.type))
    )
      return records
    throw error
  }
}

/** Lower every transient channel simulation in board order, as RoutedAdmissionSolver does one channel simulation per step. */
export function prepareChannelSimulations({
  circuit,
  sources,
  distanceMm,
}: {
  circuit: CircuitJson
  sources: IbisSources
  distanceMm?: number
}): PreparedChannelSimulation[] {
  return listChannelSimulations(circuit).map((channelSimulation) =>
    prepareChannelSimulationById({
      circuit,
      sources,
      simulationPcbTransientChannelSimulationId:
        channelSimulation.simulation_pcb_transient_channel_simulation_id,
      distanceMm,
    }),
  )
}

/** Binding inputs prepared by admission before a route binding solver allocates an artifact scope. */
type AdmittedRouteBindings = Omit<RouteBindingsInput, "scope">

/** The first admitted block's bindings, checked by the standalone admission solver. */
export function admittedBindings({
  circuitJson,
  ibisSources,
}: {
  circuitJson: CircuitJson
  ibisSources: IbisSources
}): AdmittedRouteBindings {
  const textSources = Object.fromEntries(
    Object.entries(ibisSources).map(([name, bytes]) => {
      if (typeof bytes === "string") return [name, bytes] as const
      return [
        name,
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
      ] as const
    }),
  )
  const admission = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: textSources,
  })
  admission.solve()
  return admission.getOutput().value[0].bindings
}
