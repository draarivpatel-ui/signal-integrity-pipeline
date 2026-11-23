import { toBlob } from "html-to-image"
import type { InspectorInput } from "../channel-inspector/input"
import type { SimulationRun } from "./local-run"
import { withStimulusRadius } from "./model/stimulus"

/** Kick off a local download, then release its temporary URL. */
export function downloadBlob({
  filename,
  blob,
}: {
  filename: string
  blob: Blob
}): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Export the exact edited record array, including embedded models and channel parameters. */
export function exportDesign(input: InspectorInput): void {
  let name = input.name
  if (name.endsWith(".json")) name = name.slice(0, -".json".length)
  if (name.endsWith(".circuit")) name = name.slice(0, -".circuit".length)
  const records = input.circuit.map((record) => {
    if (record.type !== "simulation_pcb_transient_channel_simulation")
      return record
    return withStimulusRadius({
      simulation: record,
      defaultMm: input.distanceMm,
    })
  })
  const blob = new Blob([`${JSON.stringify(records, null, 2)}\n`], {
    type: "application/json",
  })
  downloadBlob({ filename: `${name}.circuit.json`, blob })
}

/** Quote a probe label for a standards-compatible CSV header. */
function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Export original adaptive timestamps and each native voltage vector. */
export function exportWaveforms(run: SimulationRun): void {
  const { probes, timestampsSeconds } = run.capture
  const lines = [
    [
      "time_s",
      ...probes.map(({ name }) => {
        const metadata = run.probes[name]
        let label = name
        if (metadata)
          label = `${metadata.name}_${metadata.isDriver ? "driver" : "receiver"}_${name}`
        return csvCell(`${label}_V`)
      }),
    ].join(","),
  ]
  for (const [index, time] of timestampsSeconds.entries())
    lines.push(
      [time, ...probes.map(({ voltageLevels }) => voltageLevels[index])].join(
        ",",
      ),
    )
  downloadBlob({
    filename: `waveforms-run-${run.id}.csv`,
    blob: new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }),
  })
}

/** Rasterize the active MDI frame and its rendered SVG or WebGL content locally. */
export async function exportWindow(name: string): Promise<void> {
  const element = document.querySelector<HTMLElement>(`[data-window="${name}"]`)
  if (!element || element.hidden)
    throw new Error("Open the window before exporting it.")
  const blob = await toBlob(element, {
    pixelRatio: 2,
    skipFonts: true,
    cacheBust: false,
    style: { margin: "0", boxShadow: "none" },
  })
  if (!blob) throw new Error("The active window could not be rasterized.")
  downloadBlob({ filename: `${name}.png`, blob })
}
