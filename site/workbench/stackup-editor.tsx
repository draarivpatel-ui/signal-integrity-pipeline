import type { LayerRef } from "circuit-json"
import { type JSX, useMemo, useState } from "react"
import { type CircuitJson, circuitJsonDb } from "../../src/board"
import type { InspectorFeature } from "../channel-inspector/geometry"
import {
  copperOunceMm,
  editStackup,
  type StackLayer,
  stackupImpedance,
} from "./model/stackup"
import "./editors.css"

interface LayerFields {
  thickness?: number
  relative_permittivity?: number
  loss_tangent?: number
}

/** An editable tabular stackup with an ideal-plane impedance probe. */
export function StackupEditor({
  circuit,
  feature,
  apply,
  close,
}: {
  circuit: CircuitJson
  feature?: InspectorFeature
  apply: (circuit: CircuitJson) => void
  close: () => void
}): JSX.Element {
  const db = useMemo(() => circuitJsonDb(circuit), [circuit])
  const original = db.pcb_stackup.getWhere({})!.layers
  const [patches, setPatches] = useState<Record<number, LayerFields>>({})
  const [signalLayer, setSignalLayer] = useState<LayerRef>()
  const [referenceLayer, setReferenceLayer] = useState<LayerRef>()
  const [probeWidth, setProbeWidth] = useState<number>()
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string>()
  const wire = feature?.shapes.find((shape) => shape.shape === "wire")
  const signal = signalLayer ?? wire?.layers[0] ?? "top"
  const width = probeWidth ?? wire?.width ?? 0.2
  const copper = original.filter((layer) => layer.layer_type === "copper")
  const references = [
    ...new Set(db.pcb_copper_pour.list().map(({ layer }) => layer)),
  ].filter((layer) => layer !== signal)
  const reference = referenceLayer ?? references[0]
  const layers = useMemo(
    () =>
      original.map(
        (layer, index): StackLayer => ({ ...layer, ...patches[index] }),
      ),
    [original, patches],
  )
  const readout = useMemo(() => {
    try {
      const next = editStackup({ circuit, layers })
      return {
        data: stackupImpedance({
          circuit: next,
          signal,
          reference,
          widthMm: width,
        }),
      }
    } catch (cause) {
      return { error: (cause as Error).message }
    }
  }, [circuit, layers, signal, reference, width])
  const total = layers.reduce((sum, layer) => sum + (layer.thickness ?? 0), 0)
  let z = 0
  /** Update a single field in the local, unapplied draft. */
  const update = ({
    index,
    key,
    value,
  }: {
    index: number
    key: keyof LayerFields
    value: number
  }): void => {
    setPatches((items) => ({
      ...items,
      [index]: {
        ...items[index],
        [key]: Number.isFinite(value) ? value : undefined,
      },
    }))
  }
  return (
    <div className="wb-editor">
      <div className="wb-editor-split">
        <div className="wb-editor-scroll">
          <table className="wb-grid wb-editor-grid">
            <thead>
              <tr>
                {[
                  "#",
                  "Layer",
                  "Type",
                  "Thickness (mm)",
                  "Cu (oz)",
                  "Dk",
                  "Df",
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {layers.map((layer, index) => {
                const label =
                  layer.layer_type === "copper"
                    ? layer.layer
                    : layer.layer_type === "dielectric"
                      ? (layer.material_name ??
                        layer.dielectric_type ??
                        "Dielectric")
                      : "Soldermask"
                return (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: Physical layer order is its identity.
                    key={`stack-layer-${index}`}
                    aria-selected={selected === index}
                    onClick={() => setSelected(index)}
                  >
                    <td>{index + 1}</td>
                    <td>{label}</td>
                    <td>{layer.layer_type}</td>
                    <td>
                      <input
                        aria-label={`${label} thickness`}
                        type="number"
                        step="0.001"
                        min="0.001"
                        value={layer.thickness ?? ""}
                        onChange={(event) =>
                          update({
                            index,
                            key: "thickness",
                            value: event.target.valueAsNumber,
                          })
                        }
                      />
                    </td>
                    <td>
                      {layer.layer_type === "copper" && (
                        <input
                          aria-label={`${label} copper weight`}
                          type="number"
                          min="0.001"
                          step="0.05"
                          value={Number(
                            (layer.thickness / copperOunceMm).toFixed(3),
                          )}
                          onChange={(event) =>
                            update({
                              index,
                              key: "thickness",
                              value: event.target.valueAsNumber * copperOunceMm,
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {"relative_permittivity" in layer && (
                        <input
                          aria-label={`${label} Dk`}
                          type="number"
                          min="1"
                          step="0.05"
                          value={layer.relative_permittivity ?? ""}
                          onChange={(event) =>
                            update({
                              index,
                              key: "relative_permittivity",
                              value: event.target.valueAsNumber,
                            })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {layer.layer_type === "dielectric" && (
                        <input
                          aria-label={`${label} Df`}
                          type="number"
                          min="0"
                          step="0.001"
                          value={layer.loss_tangent ?? ""}
                          onChange={(event) =>
                            update({
                              index,
                              key: "loss_tangent",
                              value: event.target.valueAsNumber,
                            })
                          }
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <aside className="wb-probe-pane">
          <svg
            role="img"
            aria-label="Stackup cross-section"
            viewBox="0 0 160 65"
          >
            {layers.map((layer, index) => {
              const h = (57 * (layer.thickness ?? 0)) / total
              const y = z + 4
              z += h
              const colors = {
                copper: "var(--near)",
                dielectric: "var(--glass)",
                soldermask: "var(--rail)",
              }
              return (
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: Physical layer order is its identity.
                  key={`layer-slab-${index}`}
                  x="5"
                  y={y}
                  width="150"
                  height={h}
                  fill={colors[layer.layer_type]}
                  stroke={
                    selected === index ? "var(--selected)" : "var(--outline)"
                  }
                  strokeWidth="0.8"
                />
              )
            })}
          </svg>
          <fieldset className="wb-fields">
            <legend>Impedance probe</legend>
            <label>
              Signal layer{" "}
              <select
                value={signal}
                onChange={(event) => {
                  setSignalLayer(event.target.value as LayerRef)
                  setReferenceLayer(undefined)
                }}
              >
                {copper.map(({ layer }) => (
                  <option key={layer}>{layer}</option>
                ))}
              </select>
            </label>
            <label>
              Reference plane{" "}
              <select
                value={reference ?? ""}
                onChange={(event) =>
                  setReferenceLayer(event.target.value as LayerRef)
                }
              >
                {references.length === 0 && <option value="">None</option>}
                {references.map((layer) => (
                  <option key={layer}>{layer}</option>
                ))}
              </select>
            </label>
            <label>
              Trace width (mm){" "}
              <input
                type="number"
                min="0.001"
                step="0.01"
                value={width}
                onChange={(event) =>
                  setProbeWidth(event.target.valueAsNumber || 0)
                }
              />
            </label>
            {readout.data && (
              <dl className="wb-readout">
                <dt>Single-ended Z₀</dt>
                <dd>{readout.data.ohms.toFixed(1)} Ω</dd>
                <dt>Propagation delay</dt>
                <dd>{readout.data.delayPsPerMm.toFixed(2)} ps/mm</dd>
                <dt>Effective Dk</dt>
                <dd>{readout.data.effectiveDk.toFixed(2)}</dd>
              </dl>
            )}
            {readout.error && (
              <p role="alert" className="wb-inline-error">
                {readout.error}
              </p>
            )}
            <small>
              {wire ? feature?.id : "Ideal plane at the selected layer"}
            </small>
          </fieldset>
        </aside>
      </div>
      {error && (
        <p role="alert" className="wb-inline-error">
          {error}
        </p>
      )}
      <div className="wb-editor-actions">
        <span>Stack thickness {total.toFixed(3)} mm</span>
        <button
          disabled={!Object.keys(patches).length}
          onClick={() => {
            try {
              apply(editStackup({ circuit, layers }))
              setPatches({})
              setError(undefined)
            } catch (cause) {
              setError((cause as Error).message)
            }
          }}
        >
          Apply
        </button>
        <button
          onClick={() => {
            setPatches({})
            setError(undefined)
          }}
        >
          Revert
        </button>
        <button onClick={close}>Close</button>
      </div>
    </div>
  )
}
