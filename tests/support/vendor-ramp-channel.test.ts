import { test } from "bun:test"
import { verifyVendorChannel } from "../fixtures/vendor-channel"
import { hasVendorModels, vendorModels } from "../fixtures/vendor-models"

test.skipIf(!hasVendorModels)(
  "SN74V245 uses the typical ramp when the file has no waveform tables",
  async () => {
    const fifo = { device: vendorModels.fifo, powerPin: "49", groundPin: "51" }
    // [Pin] 53–56 identifies A, VCC, Y and GND.
    await verifyVendorChannel({
      driver: {
        ...fifo,
        pin: "50",
        model: "OPH83",
        // Model_type 109 and [Voltage Range] 126.
        capabilities: { drive: true, receive: false, disable: true },
        voltage: 3.3,
        // [Ramp] 351, dV/dt_r at 353: 110 ps × 4/3 = 146.67 ps.
        edgePicoseconds: 147,
        rampOnly: true,
      },
      receiver: {
        ...fifo,
        pin: "1",
        model: "UI088",
        // Model_type 60 and [Voltage Range] 76.
        capabilities: { drive: false, receive: true, disable: false },
        voltage: 3.3,
      },
    })
  },
)
