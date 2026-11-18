import type { CrossSection } from "../../src/extraction"

/** Thin rectangular lines approach the zero-thickness published oracles without altering them. */
export function sectionFixture(
  kind: "microstrip" | "stripline" | "mask",
  count = 1,
): CrossSection {
  return {
    conductors: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      xMm: (i - (count - 1) / 2) * 1.5,
      zMm: 1,
      widthMm: 1,
      thicknessMm: kind === "mask" ? 0.035 : 0.001,
    })),
    planes: kind === "stripline" ? [{ zMm: 0 }, { zMm: 2.001 }] : [{ zMm: 0 }],
    dielectrics: [
      {
        zMm: 0,
        thicknessMm: kind === "stripline" ? 2.001 : 1,
        er: 4,
        lossTangent: 0.02,
      },
      ...(kind === "mask"
        ? [{ zMm: 1, thicknessMm: 0.055, er: 3.3, lossTangent: 0.025 }]
        : []),
    ],
  }
}
