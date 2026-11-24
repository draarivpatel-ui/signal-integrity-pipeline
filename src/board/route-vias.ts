import type { PcbVia } from "circuit-json"
import type { PcbViaId } from "./ids"
import type { RouteVia } from "./route-section-types"
import type { LayerRef } from "./schema"

/** Convert physical via records, including standalone vias, to geometry. */
export function readRouteVia(via: PcbVia): RouteVia {
  return {
    pcbViaId: via.pcb_via_id,
    pcbTraceId: via.pcb_trace_id,
    sourceTraceId: via.source_trace_id,
    sourceNetId: via.source_net_id,
    point: [via.x, via.y],
    layers: via.layers,
    outerDiameterMm: via.outer_diameter,
  }
}

/** Resolve the canonical barrel span and keep one entry for each physical via. */
export function collectRouteVias({
  scopedVias,
  routeVias,
  boardLayers,
  allowsBlindVias,
}: {
  scopedVias: RouteVia[]
  routeVias: RouteVia[]
  boardLayers: readonly LayerRef[]
  allowsBlindVias: boolean
}): RouteVia[] {
  const seenPcbViaIds = new Set<PcbViaId>()
  const vias: RouteVia[] = []
  for (const via of [...scopedVias, ...routeVias]) {
    if (via.pcbViaId !== undefined) {
      if (seenPcbViaIds.has(via.pcbViaId)) continue
      seenPcbViaIds.add(via.pcbViaId)
    }
    let layers = [...boardLayers]
    if (allowsBlindVias) {
      const layerIndices = via.layers.map((layer) => boardLayers.indexOf(layer))
      const firstLayerIndex = Math.min(...layerIndices)
      const lastLayerIndex = Math.max(...layerIndices)
      layers = boardLayers.slice(firstLayerIndex, lastLayerIndex + 1)
      if (layerIndices[0] > layerIndices[layerIndices.length - 1])
        layers.reverse()
    }
    vias.push({ ...via, layers })
  }
  return vias
}
