import { test } from "bun:test"
import { verifyVendorChannel } from "../fixtures/vendor-channel"
import { hasVendorModels, vendorModels } from "../fixtures/vendor-models"

test.skipIf(!hasVendorModels)(
  "SN74LVC8T245 selects the mapped supply on each side",
  async () => {
    const endpoint = {
      device: vendorModels.levelShifter,
      groundPin: "11",
      capabilities: { drive: true, receive: true, disable: true } as const,
    }
    // [Pin] 93, 95, 103, 113 and 115 identify VCCA, A1, GND, B1 and VCCB.
    await verifyVendorChannel({
      driver: {
        ...endpoint,
        pin: "21",
        powerPin: "23",
        otherPowerPin: "1",
        modelChoice: "LVC8T245_IO_33",
        model: "LVC8T245_IO_33",
        // Model_type 2912 and [Voltage Range] 2929.
        voltage: 3.3,
        // [Falling Waveform] 3606, crossings at rows 3648–3649 and 3679–3680.
        edgePicoseconds: 1264,
      },
      receiver: {
        ...endpoint,
        pin: "3",
        powerPin: "1",
        otherPowerPin: "23",
        modelChoice: "LVC8T245_IO_18",
        model: "LVC8T245_IO_18",
        // sn74lvc8t245.ibs [Model Selector] 310, Model_type 1294 and [Voltage Range] 1311.
        voltage: 1.8,
        // [Falling Waveform] 1986, crossings at rows 2042–2043 and 2057–2058.
        edgePicoseconds: 2360,
      },
    })
  },
)
