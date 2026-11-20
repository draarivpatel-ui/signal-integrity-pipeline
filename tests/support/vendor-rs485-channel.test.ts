import { test } from "bun:test"
import { verifyVendorChannel } from "../fixtures/vendor-channel"
import { vendorModels } from "../fixtures/vendor-models"

test("SN65HVD72 A uses explicit IBIS reference voltages and a typical waveform", async () => {
  const endpoint = {
    device: vendorModels.rs485,
    // [Pin] 79–82 identifies A (6), GND (5) and VCC (8).
    pin: "6",
    powerPin: "8",
    groundPin: "5",
    model: "a_b_p",
    // Model_type 1228 and [Pullup Reference] / [POWER Clamp Reference] 1254–1256.
    capabilities: { drive: true, receive: true, disable: true } as const,
    voltage: 3.3,
    // [Rising Waveform] 1826, crossings at rows 1851–1852 and 1911–1912.
    edgePicoseconds: 592_294,
  }
  await verifyVendorChannel({ driver: endpoint, receiver: endpoint })
})
