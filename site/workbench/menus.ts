import type { Command, Menu, Theme } from "./chrome"
import { themeIds, themes } from "./chrome"
import type { IconName } from "./icons"
import {
  type Arrange,
  type Frame,
  type WindowId,
  windowTitles,
} from "./windows"

const commandInfo = {
  open: ["Open Circuit JSON…", "Ctrl+O", "open"],
  sample: ["Open Sample", "Ctrl+Shift+O", "sample"],
  save: ["Save Design As…", "Ctrl+S", "save"],
  csv: ["Waveforms as CSV…", "Ctrl+E", "scope"],
  png: ["Active Window as PNG…", "Ctrl+Shift+P", "save"],
  close: ["Close Board", "Ctrl+W", null],
  undo: ["Undo Design Edit", "Ctrl+Z", null],
  redo: ["Redo Design Edit", "Ctrl+Y", null],
  victim: ["Make Selected Net Victim", "V", null],
  aggressor: ["Make Selected Net Aggressor", "A", null],
  exclude: ["Exclude Selected Net", "Delete", null],
  clear: ["Clear Selection", "Escape", null],
  board: ["Board Viewer", null, "board"],
  stackup: ["Stackup Editor", "Ctrl+K", "stackup"],
  assign: ["Assign Models…", "Ctrl+M", "models"],
  ibis: ["Visual IBIS Editor", "Ctrl+I", "models"],
  stimulus: ["Stimulus / Aggressors…", "Ctrl+T", "stimulus"],
  run: ["Run", "F5", "run"],
  stop: ["Stop Simulation", "Shift+F5", "stop"],
  scope: ["Oscilloscope", "F6", "scope"],
  eye: ["Eye Diagram", "F7", null],
  compare: ["Compare Previous Run", null, null],
  log: ["Simulation Log", "Ctrl+Alt+L", "log"],
  solver: ["Check Local Solver Status", null, null],
  deck: ["View Compiled SPICE Deck…", null, null],
  reset: ["Reset Design to Loaded File", null, null],
  about: ["About SI Workbench", null, null],
} as const satisfies Record<
  string,
  readonly [string, string | null, IconName | null]
>
export type CommandId = keyof typeof commandInfo
export type CommandActions = Partial<Record<CommandId, () => void>>
export const toolbarGroups = [
  ["open", "sample", "save"],
  ["board", "stackup", "assign", "ibis", "stimulus"],
  ["run", "stop", "scope", "log"],
] as const satisfies readonly (readonly CommandId[])[]

/** Read one command's label, accelerator, icon, and availability. */
export function workbenchCommand({
  id,
  actions,
}: {
  id: CommandId
  actions: CommandActions
}): Command & { icon?: IconName } {
  const [label, shortcut, icon] = commandInfo[id]
  return {
    label,
    shortcut: shortcut ?? undefined,
    action: actions[id],
    icon: icon ?? undefined,
  }
}

interface MenuOptions {
  actions: CommandActions
  recent: string[]
  theme: Theme
  selectTheme: (theme: Theme) => void
  showTree: boolean
  toggleTree: () => void
  showProperties: boolean
  toggleProperties: () => void
  frames: Frame[]
  showWindow: (id: WindowId) => void
  arrange: (mode: Arrange) => void
  comparing?: boolean
}

/** Collect all desktop commands in the menu bar and keyboard dispatch. */
export function workbenchMenus(options: MenuOptions): Menu[] {
  const {
    actions,
    recent,
    theme,
    selectTheme,
    showTree,
    toggleTree,
    showProperties,
    toggleProperties,
    frames,
    showWindow,
    arrange,
  } = options
  /** Bind command state to a menu row. */
  const item = (id: CommandId): Command => workbenchCommand({ id, actions })
  return [
    {
      label: "File",
      items: [
        item("open"),
        item("sample"),
        {
          label: "Open Recent",
          items: recent.length
            ? recent.map((name) => ({
                label: name,
                action:
                  name === "Parallel bus sample"
                    ? actions.sample
                    : actions.open,
              }))
            : [{ label: "(No recent files)" }],
        },
        { label: "File operations", separator: true },
        item("save"),
        { label: "Export", items: [item("csv"), item("png")] },
        item("close"),
      ],
    },
    {
      label: "Edit",
      items: [
        item("undo"),
        item("redo"),
        { label: "Net roles", separator: true },
        item("victim"),
        item("aggressor"),
        item("exclude"),
        item("clear"),
      ],
    },
    {
      label: "View",
      items: [
        item("board"),
        {
          label: "Project Explorer",
          shortcut: "Ctrl+Alt+P",
          checked: showTree,
          action: toggleTree,
        },
        {
          label: "Properties Inspector",
          shortcut: "Ctrl+Alt+R",
          checked: showProperties,
          action: toggleProperties,
        },
        item("log"),
        { label: "Appearance", separator: true },
        {
          label: "Theme",
          items: themeIds.map((id) => ({
            label: themes[id],
            checked: theme === id,
            action: () => selectTheme(id),
          })),
        },
      ],
    },
    { label: "Setup", items: [item("stackup"), item("stimulus")] },
    {
      label: "Models",
      items: [
        item("assign"),
        item("ibis"),
        { label: "External", separator: true },
        { label: "Load External IBIS…", title: "Coming later" },
      ],
    },
    {
      label: "Simulate",
      mnemonic: 1,
      items: [
        item("run"),
        item("stop"),
        { label: "Results", separator: true },
        item("scope"),
        item("eye"),
        { ...item("compare"), checked: options.comparing },
        item("solver"),
      ],
    },
    {
      label: "Tools",
      items: [
        {
          ...item("stackup"),
          label: "Impedance / Delay Calculator",
          shortcut: undefined,
        },
        item("deck"),
        item("reset"),
      ],
    },
    {
      label: "Window",
      items: [
        ...(["Cascade", "Tile", "Tile Vertically", "Maximize"] as const).map(
          (mode) => ({
            label: mode,
            shortcut: mode === "Cascade" ? "Shift+F4" : undefined,
            action: () => arrange(mode),
          }),
        ),
        { label: "Child windows", separator: true },
        ...frames.map(({ id }) => ({
          label: windowTitles[id],
          action: () => showWindow(id),
        })),
      ],
    },
    { label: "Help", items: [item("about")] },
  ]
}
