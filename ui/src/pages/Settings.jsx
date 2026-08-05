import { useState, useEffect } from 'react'
import { Save, RotateCcw, CheckCircle2, Server, AlertCircle } from 'lucide-react'
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
      <div className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: '#e6edf3' }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>
          Preferences for this UI only — stored in your browser, not on the cluster.
        </p>
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
            <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>Connection</h2>
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
