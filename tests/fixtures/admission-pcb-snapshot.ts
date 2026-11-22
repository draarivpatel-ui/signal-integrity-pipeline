import { expect } from "bun:test"
import assert from "node:assert/strict"
import { cju } from "@tscircuit/circuit-json-util"
import type {
  PcbFabricationNotePath,
  PcbFabricationNoteText,
} from "circuit-json"
import type { CircuitJson } from "../../src/board"
import type { RoutedChannelSimulationPlan } from "../../src/pipeline"
import { circuitNodes } from "../../src/simulation"
import "./extend-expect-circuit-snapshot"

const ROUTE_COLORS = ["#79edb8", "#ffcf7a", "#8bc9ff", "#efa7e7"]
/** Height and vertical spacing for the board-top legend, in millimetres. */
const LEGEND_FONT_MM = 0.48
const LEGEND_MARGIN_MM = 0.7
const LEGEND_LINE_MM = 0.68
const CUT_WIDTH_MM = 0.22

/** Verify every in-scope routed trace was cut and snapshot the resolved endpoint nodes. */
export function expectAdmissionPcbSnapshot({
  circuitJson,
  plan,
  expectedTraceCount,
  testPath,
  idealConnection,
}: {
  circuitJson: CircuitJson
  plan: RoutedChannelSimulationPlan
  expectedTraceCount: number
  testPath: string
  idealConnection?: string
}): void {
  const { bindings, sections } = plan
  const { node } = circuitNodes({ ...bindings, circuit: bindings.circuitJson })
  const db = cju([...circuitJson])
  const [board] = db.pcb_board.list()
  assert.ok(board?.height)
  const { channelPcbTraceIds } = sections.copperScope
  assert.equal(channelPcbTraceIds.length, expectedTraceCount)
  assert.equal(bindings.routedTraceCuts.length, expectedTraceCount)
  const paths: PcbFabricationNotePath[] = []
  const captions: PcbFabricationNoteText[] = []
  for (const [index, pcbTraceId] of channelPcbTraceIds.entries()) {
    const pcbTrace = db.pcb_trace.get(pcbTraceId)
    assert.ok(pcbTrace?.source_trace_id)
    const cut = bindings.routedTraceCuts.find(
      ({ sourceTraceId }) => sourceTraceId === pcbTrace.source_trace_id,
    )
    assert.ok(cut)
    const fromNode = node(cut.from)
    const toNode = node(cut.to)
    assert.notEqual(fromNode, toNode, cut.sourceTraceId)
    const labels = [cut.from, cut.to].map((sourcePortId) => {
      const port = db.source_port.get(sourcePortId)
      assert.ok(port?.source_component_id)
      const component = db.source_component.get(port.source_component_id)
      assert.ok(component)
      return `${component.name}.${port.name}`
    })
    const color = ROUTE_COLORS[index]
    paths.push({
      type: "pcb_fabrication_note_path",
      pcb_fabrication_note_path_id: `cut_${pcbTraceId}`,
      layer: "top",
      color,
      route: pcbTrace.route.flatMap((point) => {
        if (point.route_type === "through_pad") return []
        return [{ x: point.x, y: point.y }]
      }),
      stroke_width: CUT_WIDTH_MM,
    })
    captions.push({
      type: "pcb_fabrication_note_text",
      pcb_fabrication_note_text_id: `nodes_${pcbTraceId}`,
      layer: "top",
      font: "tscircuit2024",
      font_size: LEGEND_FONT_MM,
      text: `${labels[0]} (${fromNode}) to ${labels[1]} (${toNode})`,
      color,
      anchor_alignment: "center",
      anchor_position: {
        x: board.center.x,
        y:
          board.center.y +
          board.height / 2 -
          LEGEND_MARGIN_MM -
          index * LEGEND_LINE_MM,
      },
    })
  }
  if (idealConnection) {
    captions.push({
      ...captions[0],
      pcb_fabrication_note_text_id: "ideal_connection",
      text: idealConnection,
      color: "#ffffff",
      anchor_position: {
        x: captions[0].anchor_position.x,
        y: captions[0].anchor_position.y - captions.length * LEGEND_LINE_MM,
      },
    })
  }
  expect([...circuitJson, ...paths, ...captions]).toMatchPcbSnapshot(testPath)
}
