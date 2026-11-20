import { test } from "bun:test"
import { verifyVendorChannel } from "../fixtures/vendor-channel"
import { hasVendorModels, vendorModels } from "../fixtures/vendor-models"

test.skipIf(!hasVendorModels)(
  "SN74LVC1G04 selects input and output models and skips NC and rails",
  async () => {
    const inverter = {
      device: vendorModels.cmos,
      powerPin: "5",
      groundPin: "3",
      ncPin: "1",
    }
    // [Pin] 131–135 maps NC, A, GND, Y and VCC.
    await verifyVendorChannel({
      driver: {
        ...inverter,
        pin: "4",
        modelChoice: "LVC1G04_OUT_33",
        model: "LVC1G04_OUT_33",
        // Model_type 2146 and [Voltage Range] 2159.
        capabilities: { drive: true, receive: false, disable: false },
        voltage: 3.3,
        // [Falling Waveform] 2727, crossings at rows 2786–2787 and 2809–2810.
        edgePicoseconds: 583,
      },
      receiver: {
        ...inverter,
        pin: "2",
        modelChoice: "LVC1G04_IN_33",
        model: "LVC1G04_IN_33",
        // Model_type 512 and [Voltage Range] 520.
        capabilities: { drive: false, receive: true, disable: false },
        voltage: 3.3,
      },
    })
  },
)
