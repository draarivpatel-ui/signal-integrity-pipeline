import {
  type CircuitJson,
  type SimulationPcbTransientChannelSimulation,
  type SourcePortId,
  validateCircuitRecords,
} from "../board"
import { type IbisSources, invalidIbisSource } from "../buffers"
import { Diagnostic, type SafeId, safeId, snapshot } from "../kernel"
import type { RoutedCompileOptions } from "../simulation"
import { listChannelSimulations, validatedScopeDistanceMm } from "./signals"

/** Board and model sources supplied to channel simulation planning. */
export interface TransientChannelSimulationPlanInput {
  readonly circuitJson: CircuitJson
  readonly ibisSources: Readonly<IbisSources>
  readonly scopeDistanceMm?: number
  readonly captureDrivers?: boolean
  readonly disabledAggressorPorts?: readonly SourcePortId[]
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
        return new IbisModelBytes(capturedBytes)
      },
    })
  }
  return Object.freeze(ibisSources)
}

/** A named simulation declaration and its validated artifact ID. */
export interface ValidatedChannelSimulation {
  channelSimulation: SimulationPcbTransientChannelSimulation
  simulationPcbTransientChannelSimulationId: SafeId
}

/** Validated search radius and ordered declarations after board validation. */
export interface ValidatedBoard {
  scopeDistanceMm: number
  channelSimulations: ValidatedChannelSimulation[]
}

/** Check the board and radius once for all channel simulations, including empty boards. */
export function validatePlanningBoard({
  circuitJson,
  scopeDistanceMm,
}: TransientChannelSimulationPlanInput): ValidatedBoard {
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
export function captureTransientChannelSimulationPlanInput(
  input: TransientChannelSimulationPlanInput,
): TransientChannelSimulationPlanInput {
  return Object.freeze({
    circuitJson: structuredClone(input.circuitJson),
    scopeDistanceMm: input.scopeDistanceMm,
    captureDrivers: input.captureDrivers,
    disabledAggressorPorts: snapshot(input.disabledAggressorPorts),
    materials: snapshot(input.materials),
    ibisSources: captureIbisSources(input.ibisSources),
  })
}
