import { test } from "bun:test"
import assert from "node:assert/strict"
import {
  convertIbisModelToSpice,
  type IbisConversionMetadata,
  type IbisModelDefinition,
} from "@tscircuit/ibis-to-spice"
import { type InspectedPin, inspectPins } from "../../src/buffers/inspect"
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
  const pin = inspectPins(circuit, { [deviceAsset]: text }).get(pinMap[1])
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
