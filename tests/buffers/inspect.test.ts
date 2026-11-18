import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertIbisModelToSpice,
  type IbisConversionMetadata,
  type IbisModelDefinition,
} from "@tscircuit/ibis-to-spice"
import {
  edgeSeconds,
  type InspectedPin,
  inspectPins,
  pinCapabilities,
} from "../../src/buffers/inspect"
import {
  deviceAsset,
  ibisInspectionBoard,
  inspectionIbis,
} from "../fixtures/ibis-inspection"

type InspectionBoard = Awaited<ReturnType<typeof ibisInspectionBoard>>
type ReferencePorts = IbisConversionMetadata["pins"][number]["references"]

/** Inspect the signal on pin 1 of the rendered chip. */
function inspectedPin(
  { circuit, pinMap }: InspectionBoard,
  text: string,
): InspectedPin {
  const pin = inspectPins(circuit, {
    sources: { [deviceAsset]: text },
    ports: new Set([pinMap[1]]),
  }).get(pinMap[1])
  assert.ok(pin)
  return pin
}

/** Get the converter's references for the same chip without running a solver. */
function convertedReferences(
  text: string,
  {
    pinMap,
    extraSignal,
    references,
  }: {
    pinMap: InspectionBoard["pinMap"]
    extraSignal?: string
    references?: IbisModelDefinition["references"]
  },
): ReferencePorts {
  const pinStates = { [pinMap[1]]: { mode: "input" as const } }
  if (extraSignal) pinStates[extraSignal] = { mode: "input" }
  return convertIbisModelToSpice(
    text,
    {
      source: { content: text },
      component: "Device",
      corner: "typical",
      pinMap,
      references,
      packagePolicy: "omit",
    },
    {
      duration: "1ns",
      pinStates,
      stimuli: {},
    },
  ).metadata.pins[0].references
}

const railMapping = `[Pin Mapping] pulldown_ref pullup_ref
1 GROUND_BUS POWER_BUS
2 NC         POWER_BUS
3 GROUND_BUS NC`

test("rail bus aliases resolve to the mapped POWER and GND pin ports", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ mapping: railMapping })
  const expected = convertedReferences(text, board)
  assert.equal(expected.pullup, board.pinMap[2])
  assert.equal(expected.pulldown, board.pinMap[3])
  const pin = inspectedPin(board, text)
  assert.deepEqual(pin.references, expected)
})

test("a signal named after a pin mapping bus cannot serve as its rail", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({
    mapping: `${railMapping.replaceAll("GROUND_BUS", "VSS")}
4 VSS POWER_BUS`,
    extraPin: "4 POWER_BUS Fast",
  })
  const expected = convertedReferences(text, {
    ...board,
    extraSignal: board.pinMap[4],
  })
  assert.equal(expected.pullup, board.pinMap[2])
  assert.deepEqual(inspectedPin(board, text).references, expected)
})

test("an explicit clamp rail preserves the separate vendor pullup rail", async () => {
  const board = await ibisInspectionBoard({
    extraPin: true,
    powerClamp: "VCLAMP",
  })
  const text = inspectionIbis({
    mapping: railMapping
      .replaceAll("GROUND_BUS", "VSS")
      .replaceAll("POWER_BUS", "VDD"),
    extraPin: "4 VCLAMP POWER",
  })
  const expected = convertedReferences(text, {
    ...board,
    references: { 1: { powerClamp: board.pinMap[4] } },
  })
  assert.equal(expected.pullup, board.pinMap[2])
  assert.equal(expected.powerClamp, board.pinMap[4])
  assert.deepEqual(inspectedPin(board, text).references, expected)
})

test("a separate clamp bus resolves even without a channel override", async () => {
  const board = await ibisInspectionBoard({ extraPin: true })
  const text = inspectionIbis({
    mapping: `[Pin Mapping] pulldown_ref pullup_ref power_clamp_ref
1 VSS VDD CLAMP_BUS
2 NC VDD NC
3 VSS NC NC
4 NC NC CLAMP_BUS`,
    extraPin: "4 VCLAMP POWER",
  })
  const expected = convertedReferences(text, board)
  assert.equal(expected.powerClamp, board.pinMap[4])
  assert.deepEqual(inspectedPin(board, text).references, expected)
})

const ramp = `[Ramp]
dV/dt_r 0.36/600p 0.36/600p 0.36/600p
dV/dt_f 0.36/750p 0.36/750p 0.36/750p`

const waveform = `[Rising Waveform]
R_fixture = 50
V_fixture = 0
0 0 NA NA
1n 0.6 NA NA`

test("the loaded ramp and its linear waveform give the same 10–90% duration", async () => {
  const board = await ibisInspectionBoard()
  const modelType = "Output"
  const measured = inspectedPin(
    board,
    inspectionIbis({ modelType, modelData: [ramp, waveform].join("\n") }),
  )
  const fallback = inspectedPin(
    board,
    inspectionIbis({ modelType, modelData: ramp }),
  )
  assert.equal(Math.round(edgeSeconds(measured) * 1e12), 800)
  assert.equal(Math.round(edgeSeconds(fallback) * 1e12), 800)
})

test("a ramp remains usable with separate voltage references and no voltage range", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({
    modelType: "Output",
    referenceOnly: true,
    modelData: ramp,
  })
  assert.equal(Math.round(edgeSeconds(inspectedPin(board, text)) * 1e12), 800)
})

test("a model header accepts a comment immediately after its name", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelData: ramp }).replace(
    "[Model] Fast",
    "[Model] Fast| inline comment",
  )
  assert.equal(Math.round(edgeSeconds(inspectedPin(board, text)) * 1e12), 800)
})

test("case-distinct model names keep their own ramp durations", async () => {
  const board = await ibisInspectionBoard()
  const modelData = `${ramp.replaceAll("600p", "300p")}
[Model] FAST
Model_type Output
C_comp 1p 1p 1p
[Voltage Range] 1.2 1.2 1.2
${ramp}`
  const text = inspectionIbis({ modelType: "Output", modelData })
  const first = edgeSeconds(inspectedPin(board, text))
  const second = edgeSeconds(
    inspectedPin(board, text.replace("1 DQ Fast", "1 DQ FAST")),
  )
  assert.equal(second / first, 2)
})

test("only ramp rows in the selected model Ramp section are used", async () => {
  const board = await ibisInspectionBoard()
  const otherSection = "[Model Spec]\ndV/dt_r 0.36/100p 0.36/100p 0.36/100p"
  const text = inspectionIbis({
    modelType: "Output",
    modelData: [ramp, otherSection].join("\n"),
  })
  assert.equal(Math.round(edgeSeconds(inspectedPin(board, text)) * 1e12), 800)
})

test("scientific notation with a trailing decimal is accepted in a ramp time", async () => {
  const board = await ibisInspectionBoard()
  const modelData = "[Ramp]\ndV/dt_r 0.36/1.e-9 NA NA"
  const text = inspectionIbis({ modelType: "Output", modelData })
  assert.equal(Math.round(edgeSeconds(inspectedPin(board, text)) * 1e12), 1333)
})

test("an unavailable typical ramp row leaves the other edge usable", async () => {
  const board = await ibisInspectionBoard()
  const modelData = "[Ramp]\ndV/dt_r 0.36/na NA NA\ndV/dt_f 0.36/600p NA NA"
  const text = inspectionIbis({ modelType: "Output", modelData })
  assert.equal(Math.round(edgeSeconds(inspectedPin(board, text)) * 1e12), 800)
})

test("a model type rejected by the converter cannot be used as a receiver", async () => {
  const board = await ibisInspectionBoard()
  const text = inspectionIbis({ modelType: "Terminator" })
  assert.throws(() => convertedReferences(text, board), {
    code: "unsupported_model_type",
  })
  assert.throws(() => pinCapabilities(inspectedPin(board, text)), /unsupported/)
})

test("converter-supported model types declare their pin roles", async () => {
  const board = await ibisInspectionBoard()
  const types = [
    ["Input", { drive: false, receive: true, disable: false }],
    ["Output", { drive: true, receive: false, disable: false }],
    ["I/O", { drive: true, receive: true, disable: true }],
    ["3-state", { drive: true, receive: false, disable: true }],
  ] as const
  for (const [modelType, expected] of types) {
    const pin = inspectedPin(board, inspectionIbis({ modelType }))
    assert.deepEqual(pinCapabilities(pin), expected)
  }
})

test("inspecting an endpoint does not require the unrelated chip asset", async () => {
  const board = await ibisInspectionBoard({ extraChip: true })
  const models = board.circuit.filter(
    (row) => row.type === "simulation_ibis_model",
  )
  assert.equal(models.length, 2)
  const { circuit, pinMap } = board
  const sources = { [deviceAsset]: inspectionIbis() }
  const pins = inspectPins(circuit, { sources, ports: new Set([pinMap[1]]) })
  assert.deepEqual([...pins.keys()], [pinMap[1]])

  const other = models.find(
    (model) => model.ibis_model_asset.project_relative_path === "other.ibs",
  )
  assert.ok(other)
  const otherPort = other.ibis_pin_name_to_source_port_id[1]
  assert.throws(
    () => inspectPins(circuit, { sources, ports: new Set([otherPort]) }),
    { code: "ibis_asset_missing" },
  )
})
