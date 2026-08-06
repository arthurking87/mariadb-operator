// UI-only preferences, persisted client-side. Deliberately scoped to display/behavior of
// this panel (refresh cadence, default filters) — never operator/cluster configuration.
// See Ui.md "Settings" for why that line is drawn.

const STORAGE_KEY = 'mariadb-ui:settings'

export const DEFAULT_SETTINGS = {
  refreshInterval: 10,   // seconds, used by useAutoRefresh on Dashboard/Activity
  defaultNamespace: '',  // pre-selected namespace filter on Dashboard
  latestMariadbVersion: '11.8.5', // compared against each instance's image tag on the Overview/Health check
}

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { ...DEFAULT_SETTINGS, ...stored }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function setSettings(partial) {
  const next = { ...getSettings(), ...partial }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function resetSettings() {
  localStorage.removeItem(STORAGE_KEY)
  return { ...DEFAULT_SETTINGS }
}
