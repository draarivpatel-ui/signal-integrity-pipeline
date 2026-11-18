import { test } from "bun:test"
import assert from "node:assert/strict"
import { RoutedPipelineSolver } from "../../src/pipeline"
import { RouteNetworkSolver } from "../../src/simulation"
import { routedProblem } from "../support/routed-fixture"
import { vendorAvailable } from "../support/vendor-models"

test("network owns real ladder node samples, complete probe evidence and the executable deck", async (context) => {
  const input = await routedProblem(context)
  if (!input) return
  const port = {
    progress: (): void => undefined,
    runSolver: async (): Promise<never> => {
      throw new Error("network test must not run ngspice")
    },
  }
  const root = new RoutedPipelineSolver(input, port)
  root.solveUntilStage("RouteTransientSolver")
  const network = root.getSolver(RouteNetworkSolver.name)!
  const output = root.stageOutput("RouteNetworkSolver").value[0]
  assert.ok(network.iterations >= 3)
  assert.ok(output.evidence.cells)
  assert.ok(output.evidence.maximum_cell_delay_s)
  assert.ok(output.deck.includes("RBIAS"))
  // klu_refactor reuses the first transient pivots; the zero-diagonal skin multiport rows need KLU tol 0.1.
  assert.match(output.deck, /^\.options klu .* pivrel=0\.1$/m)
  assert.equal(
    output.probes.length,
    3,
    "two receivers and the existing rail monitor",
  )
  assert.ok(
    (output.evidence.warnings as string[]).some((warning) =>
      warning.includes("candidate channel experiment"),
    ),
  )
})

/** One unit interval is 2 ns at this rate. */
const QUIET_BIT_RATE_BPS = 500e6
/** The offset lies beyond both capture windows. */
const QUIET_OFFSET_SECONDS = 200e-9
/** The default quiet capture spans one unit interval at 500 Mbps. */
const QUIET_CAPTURE_END_SECONDS = 1 / QUIET_BIT_RATE_BPS
/** Preserve the longer regression capture with an explicit duration. */
const EXPLICIT_CAPTURE_SECONDS = 64e-9
/** Allow for rounding when ngspice writes timestamps as decimal text. */
const TIMESTAMP_TOLERANCE_SECONDS = 1e-12
/** A conservative high level for the synthetic 3.3 V output. */
const HIGH_THRESHOLD_VOLTS = 2.5

/** Assert the grounded driver holds high for every sample in the requested capture. */
async function assertConstantHighCapture({
  durationSeconds,
  expectedEndSeconds,
}: {
  durationSeconds?: number
  expectedEndSeconds: number
}): Promise<void> {
  const circuitJson = await renderCoreSignals(
    <Single
      bitRate={QUIET_BIT_RATE_BPS}
      pattern="1"
      timing={{ offsetSeconds: QUIET_OFFSET_SECONDS, durationSeconds }}
    />,
  )
  const ibisSources = { "models/sn74lvc1g04.ibs": quietDriverIbis }
  const solve = createNativeSolver({
    tools: { ngspice: process.env.NGSPICE_BIN },
  })
  const root = new RoutedPipelineSolver(
    { circuitJson, ibisSources },
    {
      progress: (): void => undefined,
      runSolver: solve,
    },
  )
  root.solveUntilStage("RouteTransientSolver")
  const compiled = root.stageOutput("RouteNetworkSolver").value[0]
  const driver = circuitJson.find(
    (record) => record.type === "simulation_pcb_driver_receiver_channel",
  )?.driver
  assert.ok(driver && "source_port_id" in driver)
  const driverProbe = compiled.probes.find(
    (probe) => probe.signalSourceId === driver.source_port_id,
  )
  assert.ok(
    driverProbe?.referenceNode === "0",
    "the driver probe is referenced to ground",
  )
  const request = routedRequest(compiled)
  const [rawFile] = request.outputFiles
  const output = await solve({
    ...request,
    args: ["-D", "filetype=ascii", ...request.args],
  })
  const waveform = output.files[rawFile]
  assert.ok(waveform, `ngspice did not write the waveform\n${output.stderr}`)
  const [header, values] = waveform.trimEnd().split("\nValues:\n")
  const variables = header.split("\nVariables:\n")[1]
  assert.ok(variables && values, "expected ASCII ngspice variables and values")
  const names = variables.split("\n").map((line) => line.trim().split("\t")[1])
  const voltageColumn = names.indexOf(
    `v(${driverProbe.signalNode.toLowerCase()})`,
  )
  assert.equal(names[0], "time")
  assert.ok(voltageColumn > 0, "the waveform contains the driver voltage")

  // Each sample records its index followed by one value per declared variable.
  const fieldsPerSample = names.length + 1
  const fields = values
    .split("\n")
    .flatMap((line) => line.split("\t"))
    .filter(Boolean)
    .map(Number)
  assert.equal(fields.length % fieldsPerSample, 0)
  const times = []
  const voltages = []
  for (let start = 0; start < fields.length; start += fieldsPerSample) {
    times.push(fields[start + 1])
    voltages.push(fields[start + 1 + voltageColumn])
  }
  const endSeconds = times.at(-1)
  assert.equal(times[0], 0)
  assert.ok(endSeconds !== undefined)
  assert.ok(
    Math.abs(endSeconds - expectedEndSeconds) <= TIMESTAMP_TOLERANCE_SECONDS,
  )
  const minVolts = Math.min(...voltages)
  assert.ok(
    minVolts >= HIGH_THRESHOLD_VOLTS,
    `expected every sample to be high, minimum was ${minVolts} V`,
  )
  console.log(
    `${voltages.length} samples, minimum ${minVolts.toFixed(9)} V, from t=0 through ${endSeconds} s`,
  )
}

test.skipIf(!process.env.SI_TEST_SWITCHING_NGSPICE)(
  "a constant-high driver stays high throughout the default capture",
  async () => {
    await assertConstantHighCapture({
      expectedEndSeconds: QUIET_CAPTURE_END_SECONDS,
    })
  },
)

test.skipIf(!process.env.SI_TEST_SWITCHING_NGSPICE)(
  "a constant-high driver stays high throughout an explicit capture",
  async () => {
    await assertConstantHighCapture({
      durationSeconds: EXPLICIT_CAPTURE_SECONDS,
      expectedEndSeconds: EXPLICIT_CAPTURE_SECONDS,
    })
  },
)
