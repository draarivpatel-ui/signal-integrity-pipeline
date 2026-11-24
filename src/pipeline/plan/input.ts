import {
  type CircuitJson,
  type SimulationPcbTransientChannelSimulation,
  validateCircuitRecords,
} from "../../board"
import { failInvalidIbisSource, type IbisSources } from "../../buffers"
import { Diagnostic, type SafeId, safeId, snapshot } from "../../kernel"
import type { RouteCompileOptions } from "../../simulation"
import { listChannelSimulations, validateNearbyGapMm } from "../signals"

/** Board and model sources supplied to channel simulation planning. */
export interface TransientChannelSimulationPlanInput {
  readonly circuitJson: CircuitJson
  readonly ibisSources: Readonly<IbisSources>
  readonly nearbyGapMm?: number
  readonly materials?: RouteCompileOptions["materials"]
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
          return failInvalidIbisSource(assetPath)
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

/** Validated nearby copper gap and ordered declarations after board validation. */
export interface ValidatedBoard {
  nearbyGapMm: number
  channelSimulations: ValidatedChannelSimulation[]
}

/** Check the board and radius once for all channel simulations, including empty boards. */
export function validatePlanningBoard({
  circuitJson,
  nearbyGapMm,
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
    nearbyGapMm: validateNearbyGapMm(nearbyGapMm),
  }
}

/** Isolate the board while leaving IBIS validation to the referenced model loader. */
export function capturePlanInput(
  input: TransientChannelSimulationPlanInput,
): TransientChannelSimulationPlanInput {
  return Object.freeze({
    circuitJson: structuredClone(input.circuitJson),
    nearbyGapMm: input.nearbyGapMm,
    materials: snapshot(input.materials),
    ibisSources: captureIbisSources(input.ibisSources),
  })
}
