import { test } from "bun:test"
import assert from "node:assert/strict"
import { closestRoutePoints } from "../../../src/extraction"
import { renderFieldsInput } from "../../fixtures/fields-input"

test.failing(
  "finds the closest points when a wire collapses to its endpoint",
  async () => {
    const { geometry } = await renderFieldsInput()
    const [first, second] = geometry.wires
    const nearest = closestRoutePoints({
      first: {
        startPoint: [...first.startPoint],
        endPoint: [...first.endPoint],
      },
      second: {
        startPoint: [...second.startPoint],
        endPoint: [...second.startPoint],
      },
    })
    assert.equal(nearest.distance, 0.35)
    assert.deepEqual(nearest.first, first.startPoint)
    assert.deepEqual(nearest.second, second.startPoint)
  },
)
