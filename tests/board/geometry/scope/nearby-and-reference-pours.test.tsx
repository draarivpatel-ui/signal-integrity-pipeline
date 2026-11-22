import { test } from "bun:test"
import assert from "node:assert/strict"
import { scopeNeighbors } from "../../../fixtures/copper-scope-board"

test("a nearby signal pour admits its net while a reference pour leaves its net unselected", async () => {
  const { scope, circuit } = await scopeNeighbors()
  const ground = circuit.find(
    (record) => record.type === "source_net" && record.name === "GND",
  )
  const other = circuit.find(
    (record) => record.type === "source_net" && record.name === "OTHER",
  )
  assert(ground?.type === "source_net")
  assert(other?.type === "source_net")
  assert(scope.extractedSourceIds.includes(other.source_net_id))
  assert(!scope.extractedSourceIds.includes(ground.source_net_id))
})
