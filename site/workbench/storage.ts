import { type Theme, themeIds } from "./chrome"

const themeKey = "tscircuit-si-workbench:chosen-theme"
const recentKey = "si-workbench.recent"

/** Read a locally stored value even when browser storage access is restricted. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Persist a preference without making browser storage a requirement. */
function store({ key, value }: { key: string; value: string }): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A sandboxed browser can disallow preferences.
  }
}

/** Restore the theme the user last chose; Dark until they choose one. */
export function loadTheme(): Theme {
  return themeIds.find((id) => id === stored(themeKey)) ?? "dark"
}

/** Switch the root theme tokens. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/** Remember a theme the user picked from the menu or toolbar. */
export function saveTheme(theme: Theme): void {
  store({ key: themeKey, value: theme })
}

/** Restore recent local filenames. Browsers require the user to reselect a file. */
export function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(stored(recentKey) ?? "[]")
    if (Array.isArray(value))
      return value.filter((name): name is string => typeof name === "string")
  } catch {
    return []
  }
  return []
}

/** Record the last six distinct design names. */
export function saveRecent({
  name,
  recent,
}: {
  name: string
  recent: string[]
}): string[] {
  const next = [name, ...recent.filter((item) => item !== name)].slice(0, 6)
  store({ key: recentKey, value: JSON.stringify(next) })
  return next
}

/** Clear filenames stored on this browser. */
export function clearRecent(): void {
  store({ key: recentKey, value: "[]" })
}
