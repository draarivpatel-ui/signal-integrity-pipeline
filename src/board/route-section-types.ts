import type { CopperPoint, CopperPolygon } from "./geometry/types"
import type {
  PcbCopperPourId,
  PcbPortId,
  PcbTraceId,
  PcbViaId,
  SourceNetId,
  SourceTraceId,
} from "./ids"
import type { LayerRef } from "./schema"
import type { BoardStackup } from "./stackup"

/** A direction vector normalized to one and without units. */
export type UnitDirection = [x: number, y: number]

/** An ideal connection from an original wire to the merged centerline. */
export interface RouteJoin {
  fromPoint: CopperPoint
  toPoint: CopperPoint
  sourceTraceId: SourceTraceId
  pcbTraceId: PcbTraceId
}

/** A straight conductor with physical endpoints and projections on its canonical axes. */
export interface RouteWire {
  wireIndex: number
  pcbTraceId: PcbTraceId
  sourceTraceId: SourceTraceId
  layer: LayerRef
  widthMm: number
  startPoint: CopperPoint
  endPoint: CopperPoint
  direction: UnitDirection
  longitudinalMinMm: number
  longitudinalMaxMm: number
  lateralOffsetMm: number
  contributingPcbTraceIds?: PcbTraceId[]
  joins?: RouteJoin[]
  startTouchesPort?: boolean
  endTouchesPort?: boolean
}

/** A copper surface or nearby edge used as an electrical reference. */
export interface RouteReference {
  pcbCopperPourId: PcbCopperPourId
  sourceNetId: SourceNetId
  layer: LayerRef
  surfaceZMm: number
  lateralGapMm?: number
}

/** A longitudinal interval containing wires with a shared reference profile. */
export interface RouteSection {
  wires: RouteWire[]
  startMm: number
  endMm: number
  references: RouteReference[]
}

/** A physical via on every layer where it can contact routed copper. */
export interface RouteVia {
  pcbViaId?: PcbViaId
  pcbTraceId?: PcbTraceId
  sourceTraceId?: SourceTraceId
  sourceNetId?: SourceNetId
  layers: LayerRef[]
  point: CopperPoint
  outerDiameterMm: number
}

/** A real pad contact and the wire reached from that pad. */
export interface RoutePortContact {
  pcbPortId: PcbPortId
  point: CopperPoint
  layer: LayerRef
  wireIndex: number
}

/** A reference pour with an outline and any cutouts. */
export interface ReferencePour {
  pcbCopperPourId: PcbCopperPourId
  sourceNetId: SourceNetId
  layer: LayerRef
  polygon: CopperPolygon
}

/** Geometric conductors and the sections prepared for field extraction. */
export interface SectionGeometry {
  stackup: BoardStackup
  wires: RouteWire[]
  sections: RouteSection[]
  pours: ReferencePour[]
  vias: RouteVia[]
  portContacts: RoutePortContact[]
  warnings: string[]
}
