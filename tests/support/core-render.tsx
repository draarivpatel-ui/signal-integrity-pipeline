import { Circuit, simulation } from "@tscircuit/core"
import type { PcbTransientChannelSimulationProps } from "@tscircuit/props"
import { createContext, type ReactElement, useContext } from "react"
import type { CircuitJson } from "../../src/board"

/** New simulation props exercised against the pipeline's pinned renderer. */
interface AggressorProps {
  aggressorPattern?: string
  aggressorsDisabled?: boolean
}

/** Aggressor declarations in the fixture, indexed by simulation name. */
type FixtureDeclarations = Map<string | undefined, AggressorProps>

const aggressorDeclarations = createContext<FixtureDeclarations | null>(null)

/** Render the simulation with pinned core and capture its aggressor declaration. */
export function FixtureChannelSimulation({
  aggressorPattern,
  aggressorsDisabled,
  ...props
}: PcbTransientChannelSimulationProps & AggressorProps): ReactElement {
  const declarations = useContext(aggressorDeclarations)
  if (aggressorPattern !== undefined || aggressorsDisabled !== undefined) {
    if (!declarations) throw new Error("Render fixtures with renderCoreSignals")
    declarations.set(props.name, { aggressorPattern, aggressorsDisabled })
  }
  return <simulation.pcbtransientchannelsimulation {...props} />
}

/** Serialize the fixture's new props onto the corresponding run rendered by core. */
function withFixtureDeclarations({
  records,
  declarations,
}: {
  records: CircuitJson
  declarations: FixtureDeclarations
}): CircuitJson {
  for (const record of records) {
    if (record.type !== "simulation_pcb_transient_channel_simulation") continue
    const props = declarations.get(record.name)
    if (!props) continue
    if (props.aggressorPattern !== undefined)
      Object.assign(record, {
        aggressor_pattern: props.aggressorPattern,
      })
    if (props.aggressorsDisabled !== undefined)
      Object.assign(record, {
        aggressors_disabled: props.aggressorsDisabled,
      })
  }
  return records
}

/** Render TSX through core and preserve partial records when it rejects the board. */
export async function renderCoreSignals(
  tree: ReactElement,
): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  const declarations: FixtureDeclarations = new Map()
  try {
    circuit.add(
      <aggressorDeclarations.Provider value={declarations}>
        {tree}
      </aggressorDeclarations.Provider>,
    )
    await circuit.renderUntilSettled()
    const records = circuit.getCircuitJson()
    const errors = records.filter((record) => record.type.endsWith("_error"))
    if (errors.length) throw new Error(JSON.stringify(errors))
    return withFixtureDeclarations({ records, declarations })
  } catch (error) {
    throw Object.assign(error as Error, {
      circuitJson: withFixtureDeclarations({
        records: circuit.db.toArray(),
        declarations,
      }),
    })
  }
}
