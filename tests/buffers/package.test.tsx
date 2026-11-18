import { test } from "bun:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { convertIbisModelToSpice, parseIbis } from "@tscircuit/ibis-to-spice"
import React from "react"
import { convertPackaged } from "../../src/buffers/package"
import { isDigit, lineRanges } from "../../src/buffers/text"
import { generalDeclarations, modelRunDefinition } from "../../src/simulation"
import { admittedBindings, renderSignals } from "../support/signal-render"
import Differential from "../support/unit-differential"
import Single from "../support/unit-single-ended"

const modelDir = process.env.IBIS_MODEL_DIR

/** Read the netlist lines with any of the requested element prefixes. */
function sourceLines(source: string, prefixes: string[]): string[] {
  return Array.from(lineRanges(source), ({ start, end }) =>
    source.slice(start, end),
  ).filter((line) => prefixes.some((prefix) => line.startsWith(prefix)))
}

/** Recover original terminal names to compare the unchanged die buffer and drive tables. */
function normalizeNodes(line: string, terminals: string[]): string {
  let result = ""
  for (let start = 0; start < line.length; ) {
    let digits = start
    if (line.startsWith("PKGL", start)) digits += 4
    if (line.startsWith("DIE", start)) digits += 3
    if (digits === start || !isDigit(line[digits])) {
      result += line[start]
      start++
      continue
    }
    let end = digits + 1
    while (isDigit(line[end])) end++
    result += terminals[Number(line.slice(digits, end))]
    start = end
  }
  return result
}

/** Upstream holds each state until 1 fs before an edge; the pipeline starts the edge from that held state. */
function held(line: string): string {
  const open = line.indexOf("PWL(")
  const close = line.lastIndexOf(")")
  if (open < 0 || close < open + 4) return line
  const knots = line.slice(open + 4, close).split(" ")
  const kept: string[] = []
  for (let i = 0; i < knots.length; i += 2) {
    if (i + 2 < knots.length && Number(knots[i + 2]) - Number(knots[i]) < 1e-14)
      kept.push(knots[(i += 2)], knots[i - 1])
    else kept.push(knots[i], knots[i + 1])
  }
  return line.slice(0, open) + `PWL(${kept.join(" ")})` + line.slice(close + 1)
}

/** Use the real TSX board and unmodified vendor model, without invoking extraction. */
async function fixture(differential = false): Promise<{
  bytes: Uint8Array
  declarations: ReturnType<typeof generalDeclarations>
}> {
  let file = "sn74lvc1g04.ibs"
  let board = <Single />
  if (differential) {
    file = "sn65hvd72.ibs"
    board = <Differential />
  }
  const bytes = await readFile(`${modelDir}/${file}`)
  const bindings = admittedBindings(await renderSignals(board), {
    [`models/${file}`]: bytes,
  })
  return {
    bytes,
    declarations: generalDeclarations({
      circuit: bindings.circuitJson,
      mappings: bindings.mappings,
      modeling: bindings.modeling,
      controls: bindings.controls,
    }),
  }
}

test.skipIf(!modelDir)(
  "ideal die rails preserve every pin package at the typical corner",
  async () => {
    for (const differential of [false, true]) {
      const { bytes, declarations } = await fixture(differential)
      const document = parseIbis(new TextDecoder().decode(bytes))
      for (const model of declarations.models) {
        const input = modelRunDefinition(model, declarations.plans[0])
        const converted = convertPackaged({ bytes, input })
        const die = convertIbisModelToSpice(
          bytes,
          { ...input.definition, packagePolicy: "omit" },
          input.run,
        )
        const component = document.components[input.definition.component]
        for (const [i, [terminal, port]] of Object.entries(
          converted.spicePinMapping,
        ).entries()) {
          const physical = Object.keys(input.definition.pinMap).find(
            (pin) => input.definition.pinMap[pin] === port,
          )!
          const pin = component.pins[physical]
          assert.ok(
            converted.source.includes(
              `RPKG${i} ${terminal} PKGR${i} ${pin.resistance ?? component.package.resistance![0]}`,
            ),
          )
          assert.ok(
            converted.source.includes(
              `LPKG${i} PKGR${i} PKGL${i} ${pin.inductance ?? component.package.inductance![0]}`,
            ),
          )
          assert.ok(converted.source.includes(`CPKG${i}a ${terminal} `))
          assert.ok(converted.source.includes(`CPKG${i}b PKGL${i} `))
          const modelName = pin.model.toLowerCase()
          if (modelName === "power" || modelName === "gnd") {
            const buffer = document.getBuffer(converted.metadata.pins[0].model)
            const voltage =
              modelName === "power"
                ? (buffer.pullupReference ?? buffer.voltage)[0]
                : (buffer.pulldownReference ?? [0, 0, 0])[0]
            assert.ok(
              converted.source.includes(`VPDN${i} DIE${i} 0 ${voltage}`),
            )
          }
        }
        // Renaming only package nodes must preserve the converter's rail references and KU/KD.
        const terminals = Object.keys(converted.spicePinMapping)
        assert.deepEqual(
          sourceLines(converted.source, ["XBUF"]).map((line) =>
            normalizeNodes(line, terminals),
          ),
          sourceLines(die.source, ["XBUF"]),
        )
        assert.deepEqual(
          sourceLines(converted.source, ["VKU", "VKD"]).map((line) =>
            normalizeNodes(line, terminals),
          ),
          sourceLines(die.source, ["VKU", "VKD"]).map(held),
        )
        assert.deepEqual(converted.metadata.omissions, [])
      }
    }
  },
)
