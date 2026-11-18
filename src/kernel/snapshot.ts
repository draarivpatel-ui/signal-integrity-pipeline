/** Copy and freeze domain values; completed stages never share mutable work state. */
export function snapshot<T>(source: T): T {
  if (Array.isArray(source))
    return Object.freeze(source.map((entry) => snapshot(entry))) as T
  if (typeof source === "function")
    throw new Error("Stage snapshots cannot contain functions")
  if (!source || typeof source !== "object") return source

  const unsupported =
    source instanceof Map || source instanceof Set || ArrayBuffer.isView(source)
  if (unsupported) throw new Error("Stage snapshots require plain values")
  const entries = Object.entries(source).map(([key, entry]) => [
    key,
    snapshot(entry),
  ])
  return Object.freeze(Object.fromEntries(entries)) as T
}
