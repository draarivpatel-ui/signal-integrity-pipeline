export const routedVisualIbis = `[IBIS Ver] 4.2
[Component] LVC1G04_DCK
[Manufacturer] Drawing fixture
[Package]
R_pkg 0 0 0
L_pkg 0 0 0
C_pkg 0 0 0
[Pin] signal_name model_name
2 A LVC1G04_IN_33
3 GND GND
4 Y LVC1G04_OUT_33
5 VCC POWER
[Model] LVC1G04_OUT_33
Model_type Output
Polarity Non-Inverting
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[Pullup]
-3.3 .066 .066 .066
0 0 0 0
6.6 -.132 -.132 -.132
[Pulldown]
-3.3 -.066 -.066 -.066
0 0 0 0
6.6 .132 .132 .132
[Ramp]
dV/dt_r 1.98/1n 1.98/1n 1.98/1n
dV/dt_f 1.98/1n 1.98/1n 1.98/1n
R_load = 50
${(["rising", "falling"] as const)
  .flatMap((kind) =>
    [0, 3.3].map(
      (voltage) =>
        `[${kind === "rising" ? "Rising" : "Falling"} Waveform]\nR_fixture = 50\nV_fixture = ${voltage}\n${[
          [0, 0],
          [0.2, 0],
          [0.4, 0.5],
          [0.6, 1],
          [0.8, 1],
          [1, 1],
          [2, 1],
          [4, 1],
        ]
          .map(([time, fraction]) => {
            const value =
              voltage / 2 + 1.65 * (kind === "rising" ? fraction : 1 - fraction)
            return `${time}n ${value} ${value} ${value}`
          })
          .join("\n")}`,
    ),
  )
  .join("\n")}
[Model] LVC1G04_IN_33
Model_type Input
C_comp 1p 1p 1p
[Voltage Range] 3.3 3.3 3.3
[End]
`
