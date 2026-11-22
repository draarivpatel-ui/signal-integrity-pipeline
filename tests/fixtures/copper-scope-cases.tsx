import type React from "react"
import { Wire } from "./copper-scope-board"

/** Arrange routes on both sides of the inclusive XY boundary. */
export function DistanceBoundaryBoard(): React.JSX.Element {
  return (
    <board width={24} height={16} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={1} width={0.5} />
      <Wire name="ON_BOUNDARY" y={1.5} extent={1} width={0.5} />
      <Wire name="BEYOND" y={-1.625} extent={1} width={0.5} />
      <Wire name="DIAGONAL_INSIDE" x={3.25} y={1} extent={1} width={0.5} />
      <Wire
        name="DIAGONAL_OUTSIDE"
        x={-3.375}
        y={-1.375}
        extent={1}
        width={0.5}
      />
    </board>
  )
}

/** Place near and far supply and return copper on one board. */
export function RailProximityBoard(): React.JSX.Element {
  return (
    <board width={24} height={24} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="GROUND" y={-0.6} extent={3} />
      <Wire name="SUPPLY" y={0.6} extent={3} />
      <Wire name="FAR_GROUND" y={-8} extent={3} />
      <Wire name="FAR_SUPPLY" y={8} extent={3} />
      <trace from=".GROUND > .A" to="net.GND" />
      <trace from=".FAR_GROUND > .A" to="net.GND" />
      <trace from=".SUPPLY > .A" to="net.VDD" />
      <trace from=".FAR_SUPPLY > .A" to="net.VDD" />
      <via
        pcbX={8}
        pcbY={-8}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.GND"
      />
      <via
        pcbX={8}
        pcbY={8}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.VDD"
      />
      <via
        pcbX={0}
        pcbY={0.7}
        fromLayer="top"
        toLayer="bottom"
        connectsTo="net.VDD"
      />
    </board>
  )
}

/** Join near and far routes through resistors. */
export function PassiveBridgesBoard(): React.JSX.Element {
  return (
    <board width={25} height={24} routeRemaining={false} schematicDisabled>
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="NEAR" y={0.6} extent={3} />
      <Wire name="FAR" y={6} extent={3} />
      <Wire name="LAST" y={9} extent={3} />
      <resistor name="R2" resistance="33" footprint="0402" pcbX={8} pcbY={7} />
      <resistor name="R1" resistance="33" footprint="0402" pcbX={8} pcbY={4} />
      <resistor
        name="RG"
        resistance="10k"
        footprint="0402"
        pcbX={8}
        pcbY={-4}
      />
      <resistor
        name="RV"
        resistance="10k"
        footprint="0402"
        pcbX={8}
        pcbY={-6}
      />
      <trace from=".R1 > .pin1" to=".NEAR > .B" />
      <trace from=".R1 > .pin2" to=".FAR > .A" />
      <trace from=".R2 > .pin1" to=".FAR > .B" />
      <trace from=".R2 > .pin2" to=".LAST > .A" />
      <trace from=".RG > .pin1" to=".NEAR > .A" />
      <trace from=".RG > .pin2" to="net.GND" />
      <trace from=".RV > .pin1" to=".NEAR > .A" />
      <trace from=".RV > .pin2" to="net.VDD" />
    </board>
  )
}

/** Put a via on a neighboring net beside a bottom-layer channel. */
export function ThroughHoleViaBoard({
  allowBlindAndBuriedVias,
}: {
  allowBlindAndBuriedVias: boolean
}): React.JSX.Element {
  return (
    <board
      width={18}
      height={18}
      layers={4}
      allowBlindAndBuriedVias={allowBlindAndBuriedVias}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} layer="bottom" />
      <Wire name="NEIGHBOR" y={5} extent={3} />
      <trace from=".NEIGHBOR > .A" to="net.STUB" />
      <via
        pcbX={0}
        pcbY={0.6}
        fromLayer="top"
        toLayer="inner1"
        connectsTo="net.STUB"
      />
    </board>
  )
}

/** Place a blind via one layer above the selected wire. */
export function BlindViaBoard(): React.JSX.Element {
  return (
    <board
      width={22}
      height={18}
      layers={4}
      allowBlindAndBuriedVias
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={9} layer="inner2" />
      <via
        pcbX={0}
        pcbY={0.6}
        fromLayer="top"
        toLayer="inner1"
        connectsTo="net.NEIGHBOR"
      />
    </board>
  )
}

/** Place a nearby signal pour on the net of a distant wire. */
export function NearbyPourBoard(): React.JSX.Element {
  return (
    <board
      width={18}
      height={18}
      layers={4}
      routeRemaining={false}
      schematicDisabled
    >
      <Wire name="SELECTED" y={0} extent={3} />
      <Wire name="DISTANT" y={5} extent={3} />
      <trace from=".DISTANT > .A" to="net.NEIGHBOR" />
      <copperpour
        name="NEAR"
        layer="top"
        connectsTo="net.NEIGHBOR"
        unbroken
        outline={[
          { x: -6, y: 0.6 },
          { x: -2, y: 0.6 },
          { x: -2, y: 5.6 },
          { x: -6, y: 5.6 },
        ]}
      />
      <copperpour
        name="FAR"
        layer="top"
        connectsTo="net.NEIGHBOR"
        unbroken
        outline={[
          { x: 2, y: 4 },
          { x: 5, y: 4 },
          { x: 5, y: 6.5 },
          { x: 2, y: 6.5 },
        ]}
      />
    </board>
  )
}
