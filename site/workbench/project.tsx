import type { JSX, MouseEvent, ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import {
  circuitJsonDb,
  endpointPorts,
  type SourcePortId,
} from "../../src/board"
import type { InspectorFeature } from "../channel-inspector/geometry"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import { Icon, type IconName } from "./icons"
import { tracePorts } from "./model/net-roles"

type Field = [label: string, value: ReactNode]
export interface PropertyGroup {
  name: string
  fields: Field[]
}
export interface ProjectNode {
  id: string
  label: string
  icon: IconName
  copper?: InspectorFeature
  port?: SourcePortId
  modelId?: string
  run?: number
  simulation?: number
  window?: "board" | "stackup" | "scope"
  groups?: PropertyGroup[]
  description?: string
  collapsed?: boolean
  children?: ProjectNode[]
}

export interface ResultNode {
  id: number
  label: string
  fields: Field[]
}

/** Give the project tree and property grid the same board, pin, and capture records. */
export function projectNodes({
  input,
  active,
  features,
  results = [],
}: {
  input: InspectorInput
  active?: ChannelSimulation
  features: InspectorFeature[]
  results?: ResultNode[]
}): ProjectNode {
  const db = circuitJsonDb(input.circuit)
  const featurePorts = new Map(
    features.flatMap((feature) => {
      if (feature.record.type !== "pcb_trace") return []
      return [
        [
          feature.id,
          tracePorts({ circuit: input.circuit, trace: feature.record }),
        ] as const,
      ]
    }),
  )
  const records = db.simulation_ibis_model.list()
  const simulations = input.simulations.map(
    (simulation, index): ProjectNode => {
      const id = simulation.simulation_pcb_transient_channel_simulation_id
      const channels = db.simulation_pcb_driver_receiver_channel.list({
        simulation_pcb_transient_channel_simulation_id: id,
      })
      const copper = simulation === active ? features : []
      const buckets = [
        { name: "Channels (Victims)", category: "selected" },
        { name: "Aggressors", category: "near" },
        { name: "Rails", category: "rail" },
        { name: "Far Nets", category: "far" },
      ] as const
      return {
        id,
        label: simulation.name ?? id,
        icon: "stimulus",
        simulation: index,
        collapsed: simulation !== active,
        groups: [
          {
            name: "Timing",
            fields: [
              ["Bit rate", `${simulation.bit_rate_bps / 1e6} Mbps`],
              [
                "Duration",
                simulation.duration_ms === undefined
                  ? "Automatic"
                  : `${simulation.duration_ms * 1e6} ns`,
              ],
              ["Scope radius", `${input.distanceMm} mm`],
            ],
          },
          {
            name: "Aggressors",
            fields: [
              ["Pattern", simulation.aggressor_pattern ?? "Unspecified"],
              ["Disabled", simulation.aggressor_disabled ? "Yes" : "No"],
            ],
          },
        ],
        description:
          "A transient simulation groups victim channels, aggressor settings, and a recording duration.",
        children: buckets.map(
          ({ name, category }): ProjectNode => ({
            id: `${id}:${category}`,
            label: name,
            icon: "folder",
            collapsed: category === "rail",
            children:
              category === "selected"
                ? channels.map((channel) => {
                    const ports = endpointPorts(channel.driver)
                    const feature = copper.find(
                      (entry) =>
                        entry.category === "selected" &&
                        featurePorts
                          .get(entry.id)
                          ?.some((port) =>
                            (ports as readonly SourcePortId[]).includes(port),
                          ),
                    )
                    return {
                      id: channel.simulation_pcb_driver_receiver_channel_id,
                      label: channel.name,
                      icon: "stimulus",
                      copper: feature,
                      groups: [
                        {
                          name: "Channel",
                          fields: [
                            [
                              "Driver",
                              ports
                                .map(
                                  (port) =>
                                    db.source_port.get(port)?.name ?? port,
                                )
                                .join(", "),
                            ],
                            [
                              "Receivers",
                              channel.receivers
                                .flatMap(endpointPorts)
                                .map(
                                  (port) =>
                                    db.source_port.get(port)?.name ?? port,
                                )
                                .join(", "),
                            ],
                            ["Pattern", channel.pattern],
                            ["Bit rate", `${channel.bit_rate_bps / 1e6} Mbps`],
                          ],
                        },
                      ],
                    }
                  })
                : copper
                    .filter((feature) => feature.category === category)
                    .map((feature) => {
                      const record = feature.record
                      const port = featurePorts.get(feature.id)?.[0]
                      const sourcePort = port && db.source_port.get(port)
                      let label = feature.id
                      if (sourcePort) {
                        const component = sourcePort.source_component_id
                          ? db.source_component.get(
                              sourcePort.source_component_id,
                            )
                          : undefined
                        label = [component?.name, sourcePort.name]
                          .filter(Boolean)
                          .join(".")
                      }
                      if (record.type !== "pcb_trace" && record.source_net_id) {
                        const name = db.source_net.get(
                          record.source_net_id,
                        )?.name
                        if (name)
                          label = `${name} · ${record.type === "pcb_via" ? "Via" : "Pour"}`
                      }
                      return {
                        id: feature.id,
                        label,
                        icon: "pin",
                        copper: feature,
                        port,
                      }
                    }),
          }),
        ),
      }
    },
  )
  const components = db.source_component
    .list()
    .map((component): ProjectNode => {
      const id = component.source_component_id
      const model = records.find(
        ({ source_component_id }) => source_component_id === id,
      )
      const ports = db.source_port.list({ source_component_id: id })
      return {
        id,
        label: component.name ?? id,
        icon: "models",
        collapsed: true,
        modelId: model?.simulation_ibis_model_id,
        groups: [
          {
            name: "Component",
            fields: [
              ["ID", id],
              ["Type", component.ftype],
              ["IBIS component", model?.ibis_component_name ?? "Unassigned"],
            ],
          },
        ],
        children: ports.map((port) => {
          const pin = Object.entries(
            model?.ibis_pin_name_to_source_port_id ?? {},
          ).find(([, value]) => value === port.source_port_id)?.[0]
          const name = pin && model?.ibis_pin_name_to_model_name?.[pin]
          return {
            id: port.source_port_id,
            port: port.source_port_id,
            label: `Pin ${port.pin_number ?? pin ?? "—"}: ${port.name ?? port.source_port_id}${name ? ` [${name}]` : ""}`,
            icon: "pin",
            modelId: model?.simulation_ibis_model_id,
            copper: features.find((feature) =>
              featurePorts.get(feature.id)?.includes(port.source_port_id),
            ),
            groups: [
              {
                name: "Pin",
                fields: [
                  ["Component", component.name ?? id],
                  ["Pin", pin ?? port.pin_number ?? "—"],
                  ["Port", port.name ?? port.source_port_id],
                ],
              },
              {
                name: "IBIS model",
                fields: [
                  ["Assigned model", name ?? "—"],
                  [
                    "Asset",
                    model?.ibis_model_asset.project_relative_path ?? "—",
                  ],
                ],
              },
            ],
          }
        }),
      }
    })
  const layers = db.pcb_stackup.getWhere({})?.layers ?? []
  return {
    id: "board",
    label: input.name,
    icon: "board",
    window: "board",
    groups: [
      {
        name: "Geometry",
        fields: [
          ["Width", `${input.board.width} mm`],
          ["Height", `${input.board.height} mm`],
          ["Thickness", `${input.board.thickness} mm`],
          ["Copper layers", input.board.layers.length],
        ],
      },
    ],
    description:
      "Dimensions are derived from the PCB outline and physical stackup.",
    children: [
      {
        id: "simulations",
        label: "Simulations",
        icon: "folder",
        children: simulations,
        description:
          "Select a transient simulation to inspect its routed copper.",
      },
      {
        id: "components",
        label: "Components",
        icon: "folder",
        children: components,
      },
      {
        id: "stackup",
        label: "Stackup",
        icon: "stackup",
        window: "stackup",
        collapsed: true,
        children: layers.map((layer, index): ProjectNode => {
          const name =
            ("layer" in layer ? layer.layer : undefined) ??
            ("material_name" in layer && layer.material_name) ??
            layer.layer_type
          return {
            id: `layer:${index}`,
            label: `${name || layer.layer_type} · ${layer.thickness} mm`,
            icon: "stackup",
            window: "stackup",
            groups: [
              {
                name: "Physical",
                fields: [
                  ["Layer", name || "—"],
                  ["Type", layer.layer_type],
                  ["Thickness", `${layer.thickness} mm`],
                  [
                    "Dk",
                    "relative_permittivity" in layer
                      ? (layer.relative_permittivity ?? "—")
                      : "—",
                  ],
                  [
                    "Df",
                    "loss_tangent" in layer ? (layer.loss_tangent ?? "—") : "—",
                  ],
                  [
                    "Conductivity",
                    "electrical_conductivity_s_per_m" in layer
                      ? (layer.electrical_conductivity_s_per_m ?? "—")
                      : "—",
                  ],
                ],
              },
            ],
          }
        }),
      },
      {
        id: "results",
        label: "Results",
        icon: "scope",
        window: "scope",
        children: results.map(
          (run): ProjectNode => ({
            id: `run:${run.id}`,
            run: run.id,
            label: run.label,
            icon: "scope",
            window: "scope",
            groups: [{ name: "Capture", fields: run.fields }],
          }),
        ),
      },
    ],
  }
}

/** Find the selected tree object after the design is edited or the board is picked. */
export function findProjectNode({
  root,
  id,
  copper,
}: {
  root?: ProjectNode
  id?: string
  copper?: string
}): ProjectNode | undefined {
  if (!root) return
  if (root.id === id || (copper && root.copper?.id === copper)) return root
  for (const child of root.children ?? []) {
    const match = findProjectNode({ root: child, id, copper })
    if (match) return match
  }
}

interface TreeActions {
  selected?: string
  pick: (node: ProjectNode) => void
  open: (node: ProjectNode) => void
  context: (input: { node: ProjectNode; event: MouseEvent }) => void
}

/** Render one branch and expand the path to selection originating from the board. */
function TreeBranch({
  node,
  actions,
}: {
  node: ProjectNode
  actions: TreeActions
}): JSX.Element {
  const [expanded, expand] = useState(!node.collapsed)
  const row = useRef<HTMLButtonElement>(null)
  const selected = node.id === actions.selected
  const expandable = (node.children?.length ?? 0) > 0
  useEffect(() => {
    if (selected) row.current?.scrollIntoView({ block: "nearest" })
    if (findProjectNode({ root: node, id: actions.selected }) && !selected)
      expand(true)
  }, [actions.selected, selected])
  return (
    <li
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
    >
      <div className="wb-tree-row">
        {expandable ? (
          <button
            className="wb-tree-expander"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
            onClick={() => expand(!expanded)}
          >
            {expanded ? "−" : "+"}
          </button>
        ) : (
          <i className="wb-tree-indent" />
        )}
        <button
          ref={row}
          className="wb-tree-node"
          onClick={() => actions.pick(node)}
          onDoubleClick={() => actions.open(node)}
          onContextMenu={(event) => actions.context({ node, event })}
          title={node.label}
        >
          {node.copper && (
            <i
              className="wb-swatch"
              style={{ background: `var(--${node.copper.category})` }}
            />
          )}
          {!node.copper && <Icon name={node.icon} />}
          <span>{node.label}</span>
        </button>
      </div>
      {expandable && expanded && (
        <ul role="group">
          {node.children!.map((item) => (
            <TreeBranch key={item.id} node={item} actions={actions} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Present the document hierarchy in a docked desktop tree. */
export function ProjectTree({
  root,
  ...actions
}: { root?: ProjectNode } & TreeActions): JSX.Element {
  if (!root) return <div className="wb-tree wb-muted">No design open</div>
  return (
    <ul className="wb-tree" role="tree" aria-label="Project Explorer">
      <TreeBranch node={root} actions={actions} />
    </ul>
  )
}
