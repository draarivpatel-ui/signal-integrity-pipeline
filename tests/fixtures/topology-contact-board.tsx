import type { SourceNetId } from "../../src/board"
import {
  SignalModel,
  SignalPin,
  type TopologyBoard,
  topologyBoard,
} from "./topology-board"

/** A routed launch and a separately routed end that can approach on either side of copper contact. */
export async function parallelTraces({
  separation,
}: {
  separation: number
}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 4, y: 0 }]}
        />
        <trace
          width={0.1}
          from=".RX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".RX > .SIG", { x: -3.98, y: separation }]}
        />
      </>
    ),
  })
}

/** A trace whose embedded via switches from the incoming layer to the destination layer. */
export async function inlineVia({
  fromLayer = "top",
}: {
  fromLayer?: "top" | "bottom"
} = {}): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} layer="bottom" />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[
            ".TX > .SIG",
            { x: 4, y: 0, via: true, fromLayer, toLayer: "bottom" },
            ".RX > .SIG",
          ]}
        />
      </>
    ),
  })
}

/** Two wires leave the driver even though both downstream ends are linear. */
export async function driverBranch(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={0} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="STUB" x={-4} />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          from=".TX > .SIG"
          to=".STUB > .SIG"
          pcbPath={[".TX > .SIG", ".STUB > .SIG"]}
        />
      </>
    ),
  })
}

/** Copper on a reference rail and an unrelated net crosses the selected signal. */
export async function railAndOtherCopper(): Promise<
  TopologyBoard & { rails: ReadonlySet<SourceNetId> }
> {
  const board = await topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={4} />
        <SignalPin name="UNRELATED" x={0} y={-4} />
        <SignalPin name="RAIL" x={0} y={4} />
        <net name="VCC" />
        <net name="OTHER" />
        <trace
          from=".TX > .SIG"
          to=".RX > .SIG"
          pcbPath={[".TX > .SIG", ".RX > .SIG"]}
        />
        <trace
          from=".TX > .SIG"
          to="net.VCC"
          pcbPath={[".TX > .SIG", { x: 4, y: 4 }, ".RAIL > .SIG"]}
        />
        <trace
          from=".UNRELATED > .SIG"
          to="net.OTHER"
          pcbPath={[".UNRELATED > .SIG", { x: 0, y: 8 }]}
        />
        <SignalPin name="UNRELATED_PAD" x={0} y={0.18} />
        <trace from=".RAIL > .SIG" to="net.VCC" />
      </>
    ),
  })
  const rail = board.circuit.find(
    (record) => record.type === "source_net" && record.name === "VCC",
  )
  if (!rail || rail.type !== "source_net")
    throw new Error("Expected core to emit VCC")
  return { ...board, rails: new Set([rail.source_net_id]) }
}

/** A straight trace ends inside the rotated copper outline of a plated receiver terminal. */
export async function rotatedPlatedHole(): Promise<TopologyBoard> {
  return topologyBoard({
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <chip
          name="RX"
          pcbX={4}
          pcbY={0}
          pcbRotation={90}
          pinLabels={{ pin1: "SIG" }}
          footprint={
            <footprint>
              <platedhole
                portHints={["pin1"]}
                shape="hole_with_polygon_pad"
                pcbX={0}
                pcbY={0}
                holeDiameter={0.2}
                holeShape="circle"
                holeOffsetX={0}
                holeOffsetY={0}
                padOutline={[
                  { x: -1, y: -0.2 },
                  { x: 1, y: -0.2 },
                  { x: 1, y: 0.2 },
                  { x: -1, y: 0.2 },
                ]}
              />
            </footprint>
          }
        />
        <SignalModel name="RX" />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 2, y: 0.65 }, { x: 8, y: 0.65 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
}

/** Two receiver pads land in the middle of one wire, in reverse declaration order. */
export async function midSegmentPads(): Promise<TopologyBoard> {
  return topologyBoard({
    receiverRef: [".RX > .SIG", ".EARLY > .SIG"],
    children: (
      <>
        <SignalPin name="TX" x={-4} />
        <SignalPin name="RX" x={2} y={0.23} />
        <SignalPin name="EARLY" x={-1} y={-0.23} />
        <net name="SIGNAL" />
        <trace
          width={0.1}
          from=".TX > .SIG"
          to="net.SIGNAL"
          pcbPath={[".TX > .SIG", { x: 8, y: 0 }]}
        />
        <trace from=".RX > .SIG" to="net.SIGNAL" />
        <trace from=".EARLY > .SIG" to="net.SIGNAL" />
      </>
    ),
  })
}
