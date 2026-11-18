import { test } from "bun:test"
import assert from "node:assert/strict"
import { simulation } from "@tscircuit/core"
import React from "react"
import { TwoTraceBoard } from "../../examples/routed/two-trace-board"
import { sha256 } from "../../src/kernel"
import { RoutedAdmissionSolver } from "../../src/pipeline"
import { prepareBlockById, signalBlocks } from "../../src/pipeline/signals"
import { renderCoreSignals } from "../support/core-render"
import { routedProblem } from "../support/routed-fixture"
import { routedVisualIbis } from "../support/routed-visual-fixture"

test("admission uses shared block lowering, retains warnings and rejects invalid scope", async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const [id] = signalBlocks(input.circuitJson).map(
    (block) => block.simulation_pcb_transient_channel_simulation_id,
  )
  const block = prepareBlockById({
    circuit: input.circuitJson,
    sources: input.ibisSources,
    blockId: id,
    distanceMm: input.scopeDistanceMm,
  })
  const solver = new RoutedAdmissionSolver(input)
  solver.step()
  assert.equal(solver.solved, true)
  const [plan] = solver.getOutput().value
  assert.deepEqual(plan.sections.circuitJson, block.circuit)
  assert.deepEqual(plan.sections.scope, block.settings.copperScope)
  assert.deepEqual(plan.warnings, block.warnings)
  assert.equal(
    solver.getOutput().value[0].sections.scope.selectedPcbTraceIds.length,
    2,
  )
  assert.throws(
    () => new RoutedAdmissionSolver({ ...input, scopeDistanceMm: 0 }).solve(),
    /scope distance/,
  )
})

test("empty boards admit no fake blocks", () => {
  const solver = new RoutedAdmissionSolver({ circuitJson: [], ibisSources: {} })
  solver.solve()
  assert.deepEqual(solver.getOutput().value, [])
})

const inverterModelPath = "models/sn74lvc1g04.ibs"

test("byte inputs retain the exact admitted model bytes", async () => {
  const circuitJson = await renderCoreSignals(<TwoTraceBoard />)
  const bytes = Buffer.from(`﻿| Synthetic Ω fixture
${routedVisualIbis}`)
  const solver = new RoutedAdmissionSolver({
    circuitJson,
    ibisSources: { [inverterModelPath]: bytes },
  })
  solver.solve()
  const {
    value: [plan],
    artifacts: [manifest],
  } = solver.getOutput()
  assert.equal(
    sha256(plan.bindings.ibisSources[inverterModelPath]),
    sha256(bytes),
  )
  assert.equal(
    JSON.parse(manifest.body).models[inverterModelPath],
    sha256(bytes),
  )
})

test("all blocks and the manifest use the same captured inputs", async () => {
  const board = TwoTraceBoard()
  const circuitJson = await renderCoreSignals(
    React.cloneElement(
      board,
      {},
      <>
        {board.props.children}
        <simulation.pcbtransientchannelsimulation name="ALT" bitRate="50Mbps">
          <simulation.pcbdriverreceiverchannel
            name="ALT_DATA"
            driverRef=".TX0 > .Y"
            receiverRef=".RX0 > .A"
          />
        </simulation.pcbtransientchannelsimulation>
      </>,
    ),
  )
  const ibisSources = { [inverterModelPath]: routedVisualIbis }
  const input = { circuitJson, ibisSources, scopeDistanceMm: 1 }
  const solver = new RoutedAdmissionSolver(input)
  solver.step()
  assert.equal(solver.solved, false)
  ibisSources[inverterModelPath] += "| Modified after the first step\n"
  signalBlocks(circuitJson)[1].name = "Changed"
  input.scopeDistanceMm = 2
  solver.step()
  const {
    value: plans,
    artifacts: [manifest],
  } = solver.getOutput()
  assert.deepEqual(
    plans.map((plan) => plan.bindings.ibisSources[inverterModelPath]),
    [routedVisualIbis, routedVisualIbis],
  )
  assert.deepEqual(
    plans.map((plan) => plan.name),
    ["TWO", "ALT"],
  )
  assert.deepEqual(
    plans.map((plan) => plan.sections.scope.lateralDistanceMm),
    [1, 1],
  )
  assert.equal(
    JSON.parse(manifest.body).models[inverterModelPath],
    sha256(routedVisualIbis),
  )
})
