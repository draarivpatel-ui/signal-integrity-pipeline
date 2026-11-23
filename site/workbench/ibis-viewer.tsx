import type { IbisBuffer, IbisCorner } from "@tscircuit/ibis-to-spice"
import { type JSX, useMemo, useState } from "react"
import type { CircuitJson } from "../../src/board"
import type { IbisFocus } from "./assign-models"
import { Chart, type Datum, type Series, sampleAt, seriesColor } from "./chart"
import { embeddedModels, tuneIbisModel } from "./model/ibis"
import { corners } from "./model/ibis-text"

/** Convert the parsed buffer's current and fixture tables to display units. */
function ibisSeries({
  buffer,
  corner,
}: {
  buffer: IbisBuffer
  corner: IbisCorner | "all"
}): { currents: Series[]; voltages: Series[] } {
  const tables = [
    { label: "Pullup", table: buffer.pullup },
    { label: "Pulldown", table: buffer.pulldown },
    { label: "Power clamp", table: buffer.powerClamp },
    { label: "Ground clamp", table: buffer.groundClamp },
  ]
  const selected = corner === "all" ? corners : [corner]
  const currents: Series[] = []
  const voltages: Series[] = []
  for (const value of selected) {
    const index = corners.indexOf(value)
    for (const [color, { label, table }] of tables.entries()) {
      const points = (table ?? [])
        .flatMap((row): Datum[] => {
          const amount = row[index + 1]
          if (amount == null) return []
          return [[row[0], amount * 1000]]
        })
        .sort((a, b) => a[0] - b[0])
      if (!points.length) continue
      currents.push({
        id: `${label}-${value}`,
        label: corner === "all" ? `${label} · ${value}` : label,
        points,
        color,
        dashed: index > 0,
      })
    }
    for (const [color, wave] of buffer.waveforms.entries()) {
      const label = `${wave.kind === "rising" ? "Rising" : "Falling"} · ${wave.resistance} Ω #${color + 1}`
      const points = wave.data.flatMap((row): Datum[] => {
        const volts = row[index + 1]
        if (volts == null) return []
        return [[row[0] * 1e9, volts]]
      })
      if (!points.length) continue
      voltages.push({
        id: `${label}-${value}`,
        label: corner === "all" ? `${label} · ${value}` : label,
        points,
        color,
        dashed: index > 0,
      })
    }
  }
  return { currents, voltages }
}

/** Present one adjustable model chart with a live cursor and trace legend. */
function IbisPlot({
  series,
  title,
  xUnit,
  yUnit,
}: {
  series: Series[]
  title: string
  xUnit: string
  yUnit: string
}): JSX.Element {
  const [x, setX] = useState<number>()
  const [hidden, setHidden] = useState<string[]>([])
  const visible = series.filter(({ id }) => !hidden.includes(id))
  return (
    <section className="wb-ibis-plot">
      <h3>{title}</h3>
      <div className="wb-ibis-chart">
        <Chart
          series={visible}
          title={title}
          xUnit={xUnit}
          yUnit={yUnit}
          onHover={setX}
        />
      </div>
      <div className="wb-plot-legend">
        {series.map((line) => {
          const y =
            x === undefined ? undefined : sampleAt({ points: line.points, x })
          return (
            <label key={line.id} style={{ color: seriesColor(line.color) }}>
              <input
                type="checkbox"
                checked={!hidden.includes(line.id)}
                onChange={(event) =>
                  setHidden((items) =>
                    event.target.checked
                      ? items.filter((id) => id !== line.id)
                      : [...items, line.id],
                  )
                }
              />
              {line.label}
              {y !== undefined && ` ${y.toPrecision(4)} ${yUnit}`}
            </label>
          )
        })}
      </div>
      <output className="wb-chart-readout">
        {x === undefined
          ? "Drag to zoom · Double-click to fit"
          : `X ${x.toPrecision(4)} ${xUnit}`}
      </output>
    </section>
  )
}

/** Inspect and modify embedded IBIS buffers with process-corner waveform views. */
export function IbisViewer({
  circuit,
  initial,
  apply,
}: {
  circuit: CircuitJson
  initial?: IbisFocus
  apply: (circuit: CircuitJson) => void
}): JSX.Element {
  const models = useMemo(() => embeddedModels(circuit), [circuit])
  const [modelId, setModel] = useState(initial?.modelId)
  const [bufferName, setBuffer] = useState(initial?.buffer)
  const [corner, setCorner] = useState<IbisCorner | "all">("typical")
  const [scale, setScale] = useState(1)
  const [cap, setCap] = useState<number>()
  const [reset, setReset] = useState(0)
  const [error, setError] = useState<string>()
  const model =
    models.find(({ record }) => record.simulation_ibis_model_id === modelId) ??
    models[0]
  const names = model?.document?.modelNames ?? []
  const name = names.find((value) => value === bufferName) ?? names[0]
  const buffer = name && model?.document?.getBuffer(name)
  const curves = useMemo(
    () => buffer && ibisSeries({ buffer, corner }),
    [buffer, corner],
  )
  return (
    <div className="wb-editor wb-ibis">
      <div className="wb-tool-row">
        <label>
          Component{" "}
          <select
            value={model?.record.simulation_ibis_model_id ?? ""}
            onChange={(event) => {
              setModel(event.target.value)
              setBuffer(undefined)
              setCap(undefined)
              setError(undefined)
            }}
          >
            {models.map((item) => (
              <option
                key={item.record.simulation_ibis_model_id}
                value={item.record.simulation_ibis_model_id}
              >
                {item.component}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model{" "}
          <select
            value={name ?? ""}
            onChange={(event) => {
              setBuffer(event.target.value)
              setCap(undefined)
              setScale(1)
              setError(undefined)
            }}
          >
            {names.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <span className="wb-separator" />
        {([...corners, "all"] as const).map((value, index) => (
          <button
            key={value}
            aria-pressed={corner === value}
            onClick={() => setCorner(value)}
          >
            {["Typ", "Min", "Max", "All"][index]}
          </button>
        ))}
        <button onClick={() => setReset((value) => value + 1)}>
          Reset Zoom
        </button>
      </div>
      <div className="wb-tool-row">
        <label>
          Drive Scale{" "}
          <input
            aria-label="Drive Scale"
            type="number"
            min="0.5"
            max="2"
            step="0.05"
            value={scale}
            onChange={(event) => setScale(event.target.valueAsNumber || 0)}
          />
          ×
        </label>
        <label>
          C_comp (pF){" "}
          <input
            aria-label="C_comp (pF)"
            type="number"
            min="0"
            step="0.1"
            value={
              cap ??
              (buffer && buffer.capacitance[0] !== null
                ? Number((buffer.capacitance[0] * 1e12).toPrecision(6))
                : "")
            }
            onChange={(event) => setCap(event.target.valueAsNumber || 0)}
          />
        </label>
        <button
          disabled={!name || (scale === 1 && cap === undefined)}
          onClick={() => {
            if (!name || !model) return
            try {
              apply(
                tuneIbisModel({
                  circuit,
                  model,
                  name,
                  scale,
                  capacitancePf: cap,
                }),
              )
              setCap(undefined)
              setScale(1)
              setError(undefined)
            } catch (cause) {
              setError((cause as Error).message)
            }
          }}
        >
          Apply to Model
        </button>
        <button
          onClick={() => {
            setCap(undefined)
            setScale(1)
            setError(undefined)
          }}
        >
          Reset Edits
        </button>
      </div>
      {(error || model?.error) && (
        <p role="alert" className="wb-inline-error">
          {error ?? model?.error}
        </p>
      )}
      {curves && (
        <div className="wb-ibis-plots" key={`${name}-${corner}-${reset}`}>
          <IbisPlot
            series={curves.currents}
            title="V–I Curves"
            xUnit="Voltage (V)"
            yUnit="mA"
          />
          <IbisPlot
            series={curves.voltages}
            title="V–t Waveforms"
            xUnit="Time (ns)"
            yUnit="V"
          />
        </div>
      )}
      {!models.length && (
        <p className="wb-placeholder">
          No IBIS models are declared in this design.
        </p>
      )}
      {buffer && (
        <div className="wb-tool-row wb-chart-readout">
          Type: {buffer.type} · V_ref: {buffer.voltage?.[0] ?? "—"} V · Asset:{" "}
          {model?.record.ibis_model_asset.project_relative_path}
        </div>
      )}
    </div>
  )
}
