import { test } from "bun:test"
import { verifyVendorChannel } from "../fixtures/vendor-channel"
import { hasVendorModels, vendorModels } from "../fixtures/vendor-models"

test.skipIf(!hasVendorModels)(
  "AM335x DDR_D0 drives W631GG6MB DQL0 with the selected 1.5 V models",
  async () => {
    await verifyVendorChannel({
      driver: {
        device: vendorModels.am335x,
        // [Pin] 118 and [Model Selector] 1401, with Model_257 at 1434.
        pin: "M3",
        modelChoice: "Model_257",
        model: "Model_257",
        powerPin: "E5",
        groundPin: "A1",
        // Model_type 432050 and [Voltage Range] 432059.
        capabilities: { drive: true, receive: false, disable: true },
        voltage: 1.5,
        // [Rising Waveform] 432468, crossings at rows 432491–432492 and 432535–432536.
        edgePicoseconds: 452,
      },
      receiver: {
        device: vendorModels.ddr3,
        // [Pin] 72 and [Model Selector] 163, with ODT_off at 169.
        pin: "E3",
        modelChoice: "ODT_off",
        model: "ODT_off",
        powerPin: "A1",
        groundPin: "B1",
        // Model_type 4560, [Voltage Range] 4567 and [Power Clamp Reference] 4569.
        capabilities: { drive: false, receive: true, disable: false },
        voltage: 1.5,
      },
    })
  },
)
