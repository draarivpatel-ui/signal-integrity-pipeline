import { simulation } from "@tscircuit/core"
import type { PcbTransientChannelSimulationProps } from "@tscircuit/props"
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
} from "react"
import Differential from "../../examples/level1-differential/level1-differential"
import { FixtureChannelSimulation } from "../support/core-render"

/** Drive retained output pins low in the vendor example used by the routed tests. */
export function VendorDifferential(): ReactElement {
  const board = Differential()
  const children = Children.map(board.props.children, (child) => {
    if (
      !isValidElement<PcbTransientChannelSimulationProps>(child) ||
      child.type !== simulation.pcbtransientchannelsimulation
    )
      return child
    return <FixtureChannelSimulation {...child.props} aggressorPattern="0" />
  })
  return cloneElement(board, {}, children)
}
