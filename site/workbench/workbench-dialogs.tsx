import type { JSX } from "react"
import type {
  ChannelSimulation,
  InspectorInput,
} from "../channel-inspector/input"
import { AssignModels, type IbisFocus } from "./assign-models"
import { Modal } from "./chrome"
import type { useDesignHistory } from "./design-history"
import { AboutDialog, DeckDialog } from "./info-dialogs"
import type { SimulationRun } from "./local-run"
import { StimulusDialog } from "./stimulus-dialog"

export type ActiveDialog =
  | { kind: "assign"; port?: string; modelId?: string }
  | { kind: "stimulus" | "deck" | "about" | "discard" }

/** Render the active desktop dialog over the workbench. */
export function WorkbenchDialogs({
  dialog,
  input,
  simulation,
  retained,
  apply,
  close,
  closeBoard,
  showCurves,
  lastRun,
  version,
}: {
  dialog?: ActiveDialog
  input?: InspectorInput
  simulation?: ChannelSimulation
  retained: ReadonlySet<string>
  apply: ReturnType<typeof useDesignHistory>["edit"]
  close: () => void
  closeBoard: () => void
  showCurves: (focus: IbisFocus) => void
  lastRun?: SimulationRun
  version?: string
}): JSX.Element | null {
  if (dialog?.kind === "assign" && input)
    return (
      <AssignModels
        circuit={input.circuit}
        port={dialog.port}
        componentId={dialog.modelId}
        retained={retained}
        apply={apply}
        close={close}
        showCurves={showCurves}
      />
    )
  if (dialog?.kind === "stimulus" && input && simulation)
    return (
      <StimulusDialog
        circuit={input.circuit}
        simulation={simulation}
        retained={retained}
        radiusMm={input.distanceMm}
        apply={apply}
        close={close}
      />
    )
  if (dialog?.kind === "deck" && lastRun)
    return <DeckDialog deck={lastRun.compiled.deck} close={close} />
  if (dialog?.kind === "about")
    return <AboutDialog version={version} close={close} />
  if (dialog?.kind === "discard")
    return (
      <Modal title="Close Board" close={close} confirm={closeBoard}>
        <p>Discard the unsaved changes to {input?.name}?</p>
      </Modal>
    )
  return null
}
