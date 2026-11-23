import type { JSX } from "react"

const icons = {
  app: ["#276bb9", "M1 2h14v12H1z", "M3 10h2V5h4v5h4V4"],
  open: ["#f2c94c", "M1 4h6l2 2h6l-2 7H1z", "M2 8h11"],
  sample: ["#4fb978", "M1 3h14v11H1z", "M4 6h3v4h5M11 6h2M4 12h2"],
  board: ["#57a774", "M1 6l7-4 7 4v4l-7 4-7-4z", "M1 6l7 4 7-4M8 10v4"],
  stackup: ["#d39d53", "M1 5l7-4 7 4v6l-7 4-7-4z", "M1 5l7 4 7-4M1 8l7 4 7-4"],
  models: [
    "#737a9b",
    "M4 4h8v8H4z",
    "M6 1v3m4-3v3M6 12v3m4-3v3M1 6h3m-3 4h3m8-4h3m-3 4h3",
  ],
  stimulus: ["#c78bba", "M1 2h14v12H1z", "M2 10h3V5h4v5h3V5h2"],
  run: ["#35b958", "M4 2l10 6-10 6z", ""],
  stop: ["#e36658", "M3 3h10v10H3z", ""],
  scope: ["#6ecfac", "M1 2h14v12H1z", "M3 10l2-3 2 3 2-5 3 2h1"],
  log: ["#eee9d2", "M3 1h7l3 3v11H3z", "M5 6h6m-6 3h6m-6 3h4"],
  save: ["#6e9cdb", "M2 1h10l2 2v12H2z", "M5 2v4h6V2M5 14v-5h6v5"],
  folder: ["#eeb849", "M1 4h6l2 2h6v7H1z", "M2 7h12"],
  pin: ["#e6ab64", "M6 1h4v8l-2 6-2-6z", "M7 4h2"],
} as const
export type IconName = keyof typeof icons

/** Draw a crisp, original 16-pixel engineering toolbar or tree icon. */
export function Icon({ name }: { name: IconName }): JSX.Element {
  const [color, silhouette, detail] = icons[name]
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      strokeLinejoin="round"
    >
      <path d={silhouette} fill={color} stroke="#20242a" />
      <path d={detail} fill="none" stroke="#20242a" />
    </svg>
  )
}
