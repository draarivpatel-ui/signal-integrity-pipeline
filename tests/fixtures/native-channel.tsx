import { Circuit } from "@tscircuit/core"
import type { TraceProps } from "@tscircuit/props"
import type { CircuitJson, Point } from "circuit-json"
import React from "react"

export type ChannelOptions = { vias?: boolean }
const points: Point[] = [
  { x: -3, y: 0 },
  { x: 3, y: 0 },
]

/** A minimal four-layer TX-to-RX DQ channel on a ground pour, optionally routed through inner2 by two vias. */
export function NativeChannel({
  vias = false,
}: ChannelOptions): React.JSX.Element {
  const local = points.map(({ x, y }) => ({
    x: x - points[0].x,
    y: y - points[0].y,
  }))
  const pcbPath: NonNullable<TraceProps["pcbPath"]> = [".TX > .DQ"]
  if (vias)
    pcbPath.push({
      ...local[0],
      via: true,
      fromLayer: "top",
      toLayer: "inner2",
    })
  pcbPath.push(...local)
  if (vias)
    pcbPath.push({
      ...local.at(-1)!,
      via: true,
      fromLayer: "inner2",
      toLayer: "top",
    })
  pcbPath.push(".RX > .DQ")
  return (
    <board
      width={60}
      height={60}
      thickness={1.6}
      layers={4}
      fabricatorPreset="jlcpcb_standard"
      routeRemaining={false}
      schematicDisabled
    >
      {(["TX", "RX"] as const).map((name, i) => (
        <chip
          key={name}
          name={name}
          pcbX={points[i].x}
          pcbY={points[i].y}
          pinLabels={{ pin1: "DQ", pin2: "GND" }}
          connections={{ GND: "net.GND" }}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                pcbX={0}
                pcbY={0}
                width={0.3}
                height={0.3}
                shape="rect"
              />
              <smtpad
                portHints={["pin2"]}
                pcbX={0}
                pcbY={-1}
                width={0.3}
                height={0.3}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      <trace
        name="DQ_ROUTE"
        from=".TX > .DQ"
        to=".RX > .DQ"
        width={0.1}
        pcbPath={pcbPath}
      />
      {(["TX", "RX"] as const).map((name, i) => (
        <React.Fragment key={`ground-${name}`}>
          <via
            name={`GND_${name}`}
            pcbX={points[i].x + 0.4}
            pcbY={points[i].y - 1}
            layers={["top", "inner1", "inner2", "bottom"]}
            holeDiameter={0.2}
            outerDiameter={0.4}
            connectsTo="net.GND"
          />
          <trace
            from={`.${name} > .GND`}
            to={`.GND_${name} > .top`}
            connectsTo={[`.${name} > .GND`, `.GND_${name} > .top`, "net.GND"]}
            width={0.15}
            pcbPath={[`.${name} > .GND`, `.GND_${name} > .top`]}
          />
        </React.Fragment>
      ))}
      <net name="GND" />
      <copperpour
        name="REFERENCE"
        layer="bottom"
        connectsTo="net.GND"
        unbroken
        outline={[
          { x: -7, y: 2 },
          { x: 7, y: 2 },
          { x: 7, y: -29 },
          { x: -7, y: -29 },
        ]}
      />
    </board>
  )
}

/** Renders the NativeChannel board through tscircuit core and returns its Circuit JSON. */
export async function nativeChannel(
  options: ChannelOptions = {},
): Promise<CircuitJson> {
  const circuit = new Circuit({ platform: { partsEngineDisabled: true } })
  circuit.add(<NativeChannel {...options} />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson()
}
