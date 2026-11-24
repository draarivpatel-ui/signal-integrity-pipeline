import {
  type CircuitJson,
  type SimulationPcbTransientChannelSimulation,
  validateCircuitRecords,
} from "../board"
import { type IbisSources, invalidIbisSource } from "../buffers"
import { Diagnostic, type SafeId, safeId } from "../kernel"
import { listChannelSimulations, validatedScopeDistanceMm } from "./signals"

/** Board and model sources supplied to routed admission. */
export interface RoutedAdmissionInput {
  readonly circuitJson: CircuitJson
  readonly ibisSources: Readonly<IbisSources>
  readonly scopeDistanceMm?: number
}

/** Capture original bytes without decoding and give readers copies of byte views. */
function captureIbisSources(
  sources: Readonly<IbisSources>,
): Readonly<IbisSources> {
  const prototype: unknown = sources && Object.getPrototypeOf(sources)
  if (!sources || (prototype !== Object.prototype && prototype !== null))
    throw new Diagnostic(
      "buffers",
      "ibis_asset",
      "Expected a plain ibisSources dictionary",
    )
  const ibisSources: IbisSources = Object.create(prototype)
  for (const assetPath of Object.keys(sources)) {
    const source = sources[assetPath]
    if (typeof source === "string") {
      Object.defineProperty(ibisSources, assetPath, {
        enumerable: true,
        value: source,
      })
      continue
    }
    if (!(source instanceof Uint8Array)) {
      Object.defineProperty(ibisSources, assetPath, {
        enumerable: true,
        get() {
          return invalidIbisSource(assetPath)
        },
      })
      continue
    }
    const capturedBytes = new Uint8Array(source)
    Object.defineProperty(ibisSources, assetPath, {
      enumerable: true,
      get() {
        return new Uint8Array(capturedBytes)
      },
    })
  }
  return Object.freeze(ibisSources)
}

/** A named simulation declaration and its validated artifact ID. */
export interface AdmittedChannelSimulation {
  channelSimulation: SimulationPcbTransientChannelSimulation
  simulationPcbTransientChannelSimulationId: SafeId
}

/** Validated search radius and ordered declarations after board admission. */
export interface AdmittedBoard {
  scopeDistanceMm: number
  channelSimulations: AdmittedChannelSimulation[]
}

/** Check the board and radius once for all channel simulations, including empty boards. */
export function admitBoard({
  circuitJson,
  scopeDistanceMm,
}: RoutedAdmissionInput): AdmittedBoard {
  validateCircuitRecords(circuitJson)
  const channelSimulations = listChannelSimulations(circuitJson).map(
    (channelSimulation) => ({
      channelSimulation,
      simulationPcbTransientChannelSimulationId: safeId({
        raw: channelSimulation.simulation_pcb_transient_channel_simulation_id,
        field: "simulationPcbTransientChannelSimulationId",
      }),
    }),
  )
  return {
    channelSimulations,
    scopeDistanceMm: validatedScopeDistanceMm(scopeDistanceMm),
  }
}

/** Isolate the board while leaving IBIS validation to the referenced model loader. */
export function captureRoutedAdmissionInput(
  input: RoutedAdmissionInput,
): RoutedAdmissionInput {
  return Object.freeze({
    circuitJson: structuredClone(input.circuitJson),
    scopeDistanceMm: input.scopeDistanceMm,
    ibisSources: captureIbisSources(input.ibisSources),
  })
}
