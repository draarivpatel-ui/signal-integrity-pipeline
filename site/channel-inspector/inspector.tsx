import type { LayerRef } from "circuit-json"
import type React from "react"
import { useCallback, useMemo, useRef, useState } from "react"
import { Board2d } from "./board-2d"
import {
  Board3d,
  type BoardInteraction,
  type CameraView,
  cameraViews,
} from "./board-3d"
import {
  categorizeCopper,
  copperCategories,
  type InspectorCopperScope,
} from "./copper"
import {
  copperStyles,
  type InspectorFeature,
  inspectorFeatures,
} from "./geometry"
import { IbisPanel } from "./ibis-panel"
import { type ChannelSimulation, type InspectorInput, loadInput } from "./input"
import "./style.css"

const initialExaggeration = 5
const viewModes = ["3D", "2D"] as const
type ViewMode = (typeof viewModes)[number]
/** Label a simulation with its name or generated record ID. */
function simulationLabel(simulation: ChannelSimulation): string {
  return (
    simulation.name ?? simulation.simulation_pcb_transient_channel_simulation_id
  )
}

/** Show the underlying record details shared by hover and click. */
function CopperDetails({
  feature,
}: {
  feature: InspectorFeature
}): React.JSX.Element {
  return (
    <>
      <strong>{feature.id}</strong>
      <span className="inspector-feature-meta">
        {feature.category} · {feature.layers.join(", ") || "No routed layers"}
      </span>
      <span>{feature.reason}</span>
    </>
  )
}

/** Show every scope class and the selected simulation's aggressor settings. */
function ScopeSummary({
  simulation,
  scope,
  distanceMm,
}: {
  simulation: ChannelSimulation
  scope: InspectorCopperScope
  distanceMm: number
}): React.JSX.Element {
  const counts = { selected: 0, near: 0, rail: 0, far: 0 }
  for (const { category } of scope.copper) counts[category]++
  return (
    <section className="inspector-card inspector-scope">
      <h2>Copper scope</h2>
      <dl className="inspector-counts">
        {copperCategories.map((category) => (
          <div key={category}>
            <dt>
              <i style={{ backgroundColor: copperStyles[category].color }} />
              {category}
            </dt>
            <dd>{counts[category]}</dd>
          </div>
        ))}
      </dl>
      <dl className="inspector-settings">
        <div>
          <dt>Search radius</dt>
          <dd>{distanceMm} mm</dd>
        </div>
        <div>
          <dt>Aggressor pattern</dt>
          <dd>{simulation.aggressor_pattern ?? "Unspecified"}</dd>
        </div>
        <div>
          <dt>Aggressors disabled</dt>
          <dd>{simulation.aggressor_disabled === true ? "Yes" : "No"}</dd>
        </div>
      </dl>
    </section>
  )
}

/** Store view controls, selection and hover for both coordinated views of one simulation. */
function SimulationViews({
  input,
  simulation,
  scope,
}: {
  input: InspectorInput
  simulation: ChannelSimulation
  scope: InspectorCopperScope
}): React.JSX.Element {
  const { board } = input
  const [mode, setMode] = useState<ViewMode>("3D")
  const [view, setView] = useState<CameraView>("Iso")
  const [cameraReset, setCameraReset] = useState(0)
  const [exaggeration, setExaggeration] = useState(initialExaggeration)
  const [hideFar, setHideFar] = useState(false)
  const [layers, setLayers] = useState<ReadonlySet<LayerRef>>(
    () => new Set(board.layers),
  )
  const [hovered, setHovered] = useState<InspectorFeature>()
  const [selected, setSelected] = useState<InspectorFeature>()
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const features = useMemo(
    () => inspectorFeatures({ copper: scope.copper, board }),
    [scope, board],
  )
  const visible = useMemo(() => {
    if (!hideFar) return features
    return features.filter(({ category }) => category !== "far")
  }, [features, hideFar])
  const interaction: BoardInteraction = {
    hovered,
    selected,
    onHover: setHovered,
    onSelect: setSelected,
  }

  return (
    <>
      <div className="inspector-layout">
        <section className="inspector-workspace" aria-label="Board views">
          <div className="inspector-toolbar">
            <div
              role="group"
              aria-label="View mode"
              className="inspector-segment"
            >
              {viewModes.map((value) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setHovered(undefined)
                    setMode(value)
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            {mode === "3D" && (
              <>
                <div
                  role="group"
                  aria-label="Camera orientation"
                  className="inspector-segment"
                >
                  {cameraViews.map((value) => (
                    <button
                      key={value}
                      aria-pressed={view === value}
                      onClick={() => {
                        setView(value)
                        setCameraReset((reset) => reset + 1)
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <label className="inspector-explode">
                  Exaggeration
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={exaggeration}
                    onChange={(event) =>
                      setExaggeration(event.target.valueAsNumber)
                    }
                  />
                  <output>{exaggeration}×</output>
                </label>
              </>
            )}
            {mode === "2D" && (
              <div
                role="group"
                aria-label="Visible layers"
                className="inspector-segment"
              >
                {board.layers.map((layer) => (
                  <button
                    key={layer}
                    aria-pressed={layers.has(layer)}
                    onClick={() => {
                      const next = new Set(layers)
                      if (next.has(layer)) next.delete(layer)
                      else next.add(layer)
                      setLayers(next)
                    }}
                  >
                    {layer}
                  </button>
                ))}
              </div>
            )}
            <label className="inspector-hide">
              <input
                type="checkbox"
                checked={hideFar}
                onChange={(event) => {
                  if (event.target.checked && hovered?.category === "far")
                    setHovered(undefined)
                  setHideFar(event.target.checked)
                }}
              />{" "}
              Hide far
            </label>
          </div>
          <div
            className="inspector-stage"
            onPointerLeave={() => setHovered(undefined)}
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect()
              setPointer({
                x: Math.max(
                  8,
                  Math.min(
                    event.clientX - bounds.left + 12,
                    bounds.width - 246,
                  ),
                ),
                y: Math.max(
                  8,
                  Math.min(event.clientY - bounds.top + 12, bounds.height - 94),
                ),
              })
            }}
          >
            <div hidden={mode !== "3D"} className="inspector-view">
              <Board3d
                board={board}
                features={visible}
                view={view}
                cameraReset={cameraReset}
                exaggeration={exaggeration}
                {...interaction}
              />
              <div className="inspector-stage-note">
                Drag to orbit · Scroll to zoom
              </div>
            </div>
            {mode === "2D" && (
              <Board2d
                board={board}
                features={visible}
                layers={layers}
                {...interaction}
              />
            )}
            {hovered && (
              <div
                role="tooltip"
                className="inspector-tooltip"
                style={{ left: pointer.x, top: pointer.y }}
              >
                <CopperDetails feature={hovered} />
              </div>
            )}
          </div>
        </section>
        <aside className="inspector-sidebar">
          <ScopeSummary
            simulation={simulation}
            scope={scope}
            distanceMm={input.distanceMm}
          />
          <section className="inspector-card inspector-selection">
            <h2>Selected copper</h2>
            {selected && <CopperDetails feature={selected} />}
            {!selected && <p>Click copper in either view to inspect it.</p>}
          </section>
        </aside>
      </div>
    </>
  )
}

/** Build the selected simulation's classification once for both views. */
function SimulationScope({
  input,
  simulation,
}: {
  input: InspectorInput
  simulation: ChannelSimulation
}): React.JSX.Element {
  const result = useMemo(() => {
    try {
      return {
        scope: categorizeCopper({
          circuit: input.circuit,
          simulation,
          distanceMm: input.distanceMm,
        }),
      }
    } catch (cause) {
      return { error: (cause as Error).message }
    }
  }, [input, simulation])
  if (!result.scope) return <p role="alert">{result.error}</p>
  return (
    <>
      <SimulationViews
        input={input}
        simulation={simulation}
        scope={result.scope}
      />
      <IbisPanel
        circuit={input.circuit}
        retainedSourceIds={result.scope.retainedSourceIds}
      />
    </>
  )
}

/** Accept a local file or sample and present simulations from the loaded Circuit JSON. */
export function ChannelInspector(): React.JSX.Element {
  const [input, setInput] = useState<InspectorInput>()
  const [index, setIndex] = useState(0)
  const [revision, setRevision] = useState(0)
  const reading = useRef(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const load = useCallback(async (file?: File) => {
    if (reading.current) return
    reading.current = true
    setLoading(true)
    setError(undefined)
    try {
      const next = await loadInput(file)
      setIndex(0)
      setInput(next)
      setRevision((value) => value + 1)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      reading.current = false
      setLoading(false)
    }
  }, [])
  return (
    <div className="channel-inspector">
      <header className="inspector-header">
        <h1>Channel inspector</h1>
        {input && (
          <span className="inspector-filename" title={input.name}>
            {input.name}
          </span>
        )}
      </header>
      <div className="inspector-load">
        <label
          className="inspector-drop"
          data-dragging={dragging}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) void load(file)
          }}
        >
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Circuit JSON file"
            disabled={loading}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void load(file)
              event.currentTarget.value = ""
            }}
          />
          <strong>Choose Circuit JSON</strong>{" "}
          <span>or drop a .json file here</span>
        </label>
        <button
          className="inspector-sample"
          disabled={loading}
          onClick={() => {
            void load()
          }}
        >
          Load sample
        </button>
        {input && (
          <label className="inspector-simulation">
            Simulation
            <select
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
            >
              {input.simulations.map((simulation, option) => (
                <option
                  key={
                    simulation.simulation_pcb_transient_channel_simulation_id
                  }
                  value={option}
                >
                  {simulationLabel(simulation)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {loading && <p role="status">Reading Circuit JSON…</p>}
      {error && <p role="alert">{error}</p>}
      {input && (
        <SimulationScope
          key={`${revision}:${index}`}
          input={input}
          simulation={input.simulations[index]}
        />
      )}
    </div>
  )
}
