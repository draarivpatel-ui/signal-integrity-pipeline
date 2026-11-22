import {
  type CircuitJson,
  type SimulationPcbTransientChannelSimulation,
  type SimulationPcbTransientChannelSimulationId,
  validateCircuitRecords,
} from "../board"
import type { IbisSources } from "../buffers"
import { safeId, snapshot } from "../kernel"
import type { RoutedCompileOptions } from "../simulation"
import { listChannelSimulations, validatedScopeDistanceMm } from "./signals"

/** Board and model sources supplied to routed admission. */
export interface RoutedAdmissionInput {
  readonly circuitJson: CircuitJson
  readonly ibisSources: Readonly<IbisSources>
  readonly scopeDistanceMm?: number
  readonly materials?: RoutedCompileOptions["materials"]
}

/** Model bytes that serialize as exact UTF-8 when exported in solver constructor inputs. */
class IbisModelBytes extends Uint8Array {
  /** Decode only during an explicit JSON export of the captured model. */
  toJSON(): string {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      this,
    )
  }
}

/** Capture original bytes without decoding and give readers copies of byte views. */
function captureIbisSources(
  sources: Readonly<IbisSources>,
): Readonly<IbisSources> {
  const ibisSources: IbisSources = Object.create(Object.getPrototypeOf(sources))
  for (const [assetPath, source] of Object.entries(sources)) {
    if (typeof source === "string") {
      Object.defineProperty(ibisSources, assetPath, {
        enumerable: true,
        value: source,
      })
      continue
    }
    const capturedBytes = new Uint8Array(source)
    Object.defineProperty(ibisSources, assetPath, {
      enumerable: true,
      get() {
        return new IbisModelBytes(capturedBytes)
      },
    })
  }
  return Object.freeze(ibisSources)
}

/** A named simulation declaration and its validated artifact ID. */
export interface AdmittedChannelSimulation {
  channelSimulation: SimulationPcbTransientChannelSimulation
  simulationPcbTransientChannelSimulationId: SimulationPcbTransientChannelSimulationId
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
    circuitJson: snapshot(input.circuitJson),
    scopeDistanceMm: input.scopeDistanceMm,
    materials: snapshot(input.materials),
    ibisSources: captureIbisSources(input.ibisSources),
  })
}
