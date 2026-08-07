import { useState, useEffect } from 'react'
import { Save, RotateCcw, CheckCircle2, Server, AlertCircle, Settings as SettingsIcon } from 'lucide-react'
import { getSettings, setSettings, resetSettings, DEFAULT_SETTINGS } from '../lib/settings'

function Field({ label, hint, children }) {
  return (
    <div className="mb-5">
      <label className="block text-sm font-medium mb-1" style={{ color: '#e6edf3' }}>{label}</label>
      {hint && <p className="text-xs mb-2" style={{ color: '#8b949e' }}>{hint}</p>}
      {children}
    </div>
  )
}

const inputStyle = {
  background: '#0d1117',
  borderColor: '#30363d',
  color: '#e6edf3',
}

export default function Settings() {
  const [form, setForm]     = useState(getSettings())
  const [saved, setSaved]   = useState(false)
  const [conn, setConn]     = useState(null)
  const [connError, setConnError] = useState(null)

  useEffect(() => {
    fetch('/api/connection')
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setConn(d) })
      .catch(e => setConnError(e.message))
  }, [])

  const handleSave = () => {
    setSettings({
      refreshInterval: Math.max(3, Number(form.refreshInterval) || DEFAULT_SETTINGS.refreshInterval),
      defaultNamespace: form.defaultNamespace.trim(),
      latestMariadbVersion: form.latestMariadbVersion.trim() || DEFAULT_SETTINGS.latestMariadbVersion,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setForm(resetSettings())
  }

  return (
    <div className="px-8 py-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3.5">
        {/* Page-title badge, same treatment as the core pages — deliberately neutral gray,
            like Docs, since this is a secondary preferences page rather than a core workflow. */}
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
          style={{ background: 'rgba(139,148,158,0.12)', borderColor: 'rgba(139,148,158,0.3)' }}>
          <SettingsIcon size={20} color="#8b949e" strokeWidth={2.25} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>Settings</h1>
          <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>
            Preferences for this UI only — stored in your browser, not on the cluster.
          </p>
        </div>
      </div>

      <div className="rounded-xl border p-6 mb-5" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <Field label="Auto-refresh interval" hint="Seconds between automatic refreshes on the Instances and Activity pages.">
          <input
            type="number"
            min={3}
            value={form.refreshInterval}
            onChange={e => setForm(f => ({ ...f, refreshInterval: e.target.value }))}
            className="w-32 px-3 py-2 rounded-lg text-sm border"
            style={inputStyle}
          />
        </Field>

        <Field label="Default namespace filter" hint="Pre-selected namespace when the Instances page loads. Leave blank to show all namespaces.">
          <input
            type="text"
            placeholder="e.g. test1"
            value={form.defaultNamespace}
            onChange={e => setForm(f => ({ ...f, defaultNamespace: e.target.value }))}
            className="w-64 px-3 py-2 rounded-lg text-sm border"
            style={inputStyle}
          />
        </Field>

        <Field label="Latest known MariaDB version" hint="Compared against each instance's image tag on its Overview page / Config Health check to flag ones that are behind. You keep this up to date yourself — nothing here queries a registry.">
          <input
            type="text"
            placeholder="e.g. 11.8.5"
            value={form.latestMariadbVersion}
            onChange={e => setForm(f => ({ ...f, latestMariadbVersion: e.target.value }))}
            className="w-32 px-3 py-2 rounded-lg text-sm border"
            style={inputStyle}
          />
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white' }}
          >
            <Save size={14} />
            Save
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border"
            style={{ color: '#8b949e', borderColor: '#30363d', background: 'transparent' }}
          >
            <RotateCcw size={14} />
            Reset to defaults
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: '#3fb950' }}>
              <CheckCircle2 size={14} />
              Saved — takes effect next time you open a page
            </span>
          )}
        </div>
      </div>

      {/* Connection info (read-only) */}
      <div className="rounded-xl border p-6" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#58a6ff22' }}>
            <Server size={16} color="#58a6ff" />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#e6edf3' }}>Connection</h2>
            <p className="text-xs" style={{ color: '#8b949e' }}>What this UI is connected to — read-only.</p>
          </div>
        </div>

        {connError ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: '#f85149' }}>
            <AlertCircle size={14} />{connError}
          </div>
        ) : !conn ? (
          <div className="text-xs" style={{ color: '#8b949e' }}>Loading…</div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt style={{ color: '#8b949e' }}>Kubeconfig context</dt>
            <dd className="font-mono" style={{ color: '#e6edf3' }}>{conn.context}</dd>
            <dt style={{ color: '#8b949e' }}>Helm release</dt>
            <dd className="font-mono" style={{ color: '#e6edf3' }}>{conn.releaseName}</dd>
            <dt style={{ color: '#8b949e' }}>Release namespace</dt>
            <dd className="font-mono" style={{ color: '#e6edf3' }}>{conn.releaseNamespace}</dd>
          </dl>
        )}
      </div>
    </div>
  )
}
