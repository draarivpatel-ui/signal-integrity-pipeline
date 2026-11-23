import { Fragment, type JSX } from "react"

/** Place two shunts across the driver and receiver sides of one channel leg. */
export function AdmissionShunts({
  pin,
  rail,
}: {
  pin: "A" | "B"
  rail: "GND" | "VCC"
}): JSX.Element {
  return (
    <>
      {["TX", "RX"].map((end, index) => (
        <Fragment key={end}>
          <resistor
            name={`RSHUNT_${end}_${pin}`}
            resistance="10k"
            footprint="0402"
            pcbX={pin === "A" ? index * 10 - 5 : index * 16 - 8}
            pcbY={pin === "A" ? 3 : -4}
            connections={{ pin1: `.${end} > .${pin}`, pin2: `net.${rail}` }}
          />
        </Fragment>
      ))}
    </>
  )
}
