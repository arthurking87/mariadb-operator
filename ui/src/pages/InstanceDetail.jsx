import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ArrowLeft, RefreshCw, Database, Server, HardDrive, Clock,
  Shield, Activity, AlertCircle, Loader2, CheckCircle2,
  XCircle, Zap, Network, Box, Copy, Check, Pencil, X, Cpu, ChevronDown,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import ResourceTab from '../components/crd/ResourceTab'
import PermissionsMatrix from '../components/crd/PermissionsMatrix'
import { CRD_SCHEMAS, INSTANCE_CRD_TABS } from '../lib/crdSchemas'
import { getSettings } from '../lib/settings'

// Compares dotted version strings numerically per segment (e.g. "11.8.5" < "11.10.0" —
// a plain string compare would get that backwards). Returns true when `version` is
// strictly behind `target`; malformed/non-numeric segments make it bail out to false
// rather than risk a false "behind" flag.
function isVersionBehind(version, target) {
  if (!version || !target || version === '—') return false
  const a = version.split('.').map(Number)
  const b = target.split('.').map(Number)
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0
    if (av < bv) return true
    if (av > bv) return false
  }
  return false
}

// ── tiny helpers ──────────────────────────────────────────────────────────────

const statusStyle = {
  Running:    { bg: 'rgba(63,185,80,0.1)',  color: '#3fb950' },
  'Not Ready':{ bg: 'rgba(248,81,73,0.1)',  color: '#f85149' },
  Pending:    { bg: 'rgba(210,153,34,0.1)', color: '#d29922' },
}

function StatusBadge({ status, small }) {
  const s = statusStyle[status] || statusStyle['Not Ready']
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}`}
      style={{ background: s.bg, color: s.color }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
      {status}
    </span>
  )
}

function MetaCard({ label, value, icon: Icon, accent, mono }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} color={accent} />
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{label}</span>
      </div>
      <div className={`text-sm font-semibold truncate ${mono ? 'font-mono' : ''}`} style={{ color: '#e6edf3' }}>{value}</div>
    </div>
  )
}

function SectionHeader({ icon: Icon, title, accent = '#8b949e' }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon size={16} color={accent} />
      <h2 className="text-base font-semibold" style={{ color: '#e6edf3' }}>{title}</h2>
    </div>
  )
}

function Pill({ ok, label }) {
  return ok
    ? <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#3fb950' }}><CheckCircle2 size={12} />{label ?? 'Yes'}</span>
    : <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#8b949e' }}><XCircle size={12} />{label ?? 'No'}</span>
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors"
      style={{ color: copied ? '#3fb950' : '#8b949e', background: 'transparent' }}>
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  )
}

// PMM_AGENT_SERVER_ADDRESS is a cluster-internal address (a K8s Service DNS name or a raw
// IP), not reachable from the browser this UI runs in — a plain <a href> to it would just
// hang or fail to resolve. When it looks like the standard <svc>.<namespace>.svc.cluster.local
// pattern, offer a copyable `kubectl port-forward` command instead of a broken "deep link".
function PmmLink({ address, instanceName }) {
  if (!address) {
    return <span className="text-xs" style={{ color: '#8b949e' }}>PMM enabled, but no server address recorded on this instance.</span>
  }
  const [host, port] = address.split(':')
  const parts = host.split('.')
  const isClusterInternal = parts.length >= 5 && host.endsWith('.svc.cluster.local')
  const svcName = isClusterInternal ? parts[0] : null
  const svcNamespace = isClusterInternal ? parts[1] : null

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm" style={{ color: '#8b949e' }}>Percona PMM</span>
        <span className="text-xs font-mono" style={{ color: '#e6edf3' }}>{address}</span>
      </div>
      {isClusterInternal ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs px-2 py-1.5 rounded truncate" style={{ background: '#0d1117', color: '#8b949e', border: '1px solid #21262d' }}>
            kubectl port-forward -n {svcNamespace} svc/{svcName} 8443:{port || 443}
          </code>
          <CopyButton text={`kubectl port-forward -n ${svcNamespace} svc/${svcName} 8443:${port || 443}`} />
        </div>
      ) : (
        <a href={`https://${address}`} target="_blank" rel="noreferrer"
          className="text-xs inline-flex items-center gap-1" style={{ color: '#58a6ff' }}>
          Open PMM Server ↗
        </a>
      )}
      <p className="text-xs mt-1.5" style={{ color: '#8b949e' }}>
        Not directly reachable from your browser (cluster-internal address) — run the command above, then open{' '}
        <span className="font-mono">https://localhost:8443</span> and search for "{instanceName}".
      </p>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center gap-2 py-10" style={{ color: '#8b949e' }}>
      <Loader2 size={16} className="animate-spin" /><span className="text-sm">Loading…</span>
    </div>
  )
}

function ErrorMsg({ msg }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
      <AlertCircle size={14} />{msg}
    </div>
  )
}

// ── replica card ─────────────────────────────────────────────────────────────

function ReplicaCard({ namespace, name, replicas, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState(replicas)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)

  const save = async () => {
    const n = parseInt(value, 10)
    if (isNaN(n) || n < 1) return setError('Must be ≥ 1')
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}/replicas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicas: n }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEditing(false)
      onSaved()
    } catch (e) { setError(e.message) }
    finally     { setSaving(false) }
  }

  const cancel = () => { setValue(replicas); setEditing(false); setError(null) }

  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center gap-2 mb-3">
        <Server size={13} color="#f97316" />
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>Replicas</span>
      </div>

      {!editing ? (
        <div className="flex items-end justify-between">
          <span className="text-2xl font-bold" style={{ color: '#e6edf3' }}>{replicas}</span>
          <button onClick={() => { setValue(replicas); setEditing(true) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e' }}>
            <Pencil size={11} />Edit
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input type="number" value={value} onChange={e => setValue(e.target.value)} min={1} max={9}
              className="w-20 px-3 py-2 rounded-lg text-lg font-bold font-mono border outline-none text-center"
              style={{ background: '#0d1117', borderColor: '#f97316', color: '#e6edf3' }}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
              autoFocus />
            <div className="flex flex-col gap-1">
              {[1,2,3,5].map(n => (
                <button key={n} onClick={() => setValue(n)}
                  className="text-xs px-2 py-0.5 rounded border"
                  style={{ borderColor: value == n ? '#f97316' : '#30363d', color: value == n ? '#f97316' : '#8b949e', background: value == n ? 'rgba(249,115,22,0.1)' : 'transparent' }}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={cancel} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border flex-1 justify-center"
              style={{ borderColor: '#30363d', color: '#8b949e' }}>
              <X size={11} />Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium flex-1 justify-center"
              style={{ background: saving ? '#30363d' : 'linear-gradient(135deg,#f97316,#ea580c)', color: saving ? '#8b949e' : 'white', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
          {error && <div className="text-xs" style={{ color: '#f85149' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}

// ── generic editable meta card ────────────────────────────────────────────────

function EditableMetaCard({ label, icon: Icon, accent, displayValue, onSave, children }) {
  const [editing, setEditing]   = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [error,   setError]     = useState(null)

  const handleSave = async (value) => {
    setSaving(true); setError(null)
    try {
      await onSave(value)
      setEditing(false)
    } catch (e) { setError(e.message) }
    finally     { setSaving(false) }
  }
  const handleCancel = () => { setEditing(false); setError(null) }

  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} color={accent} />
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{label}</span>
      </div>
      {!editing ? (
        <div className="flex items-end justify-between gap-2">
          <div className="text-sm font-semibold truncate font-mono" style={{ color: '#e6edf3' }}>{displayValue}</div>
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border flex-shrink-0 transition-colors"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e' }}>
            <Pencil size={10} />Edit
          </button>
        </div>
      ) : (
        <div className="space-y-2 mt-1">
          {children({ onSave: handleSave, onCancel: handleCancel, saving })}
          {error && (
            <div className="flex items-center gap-1.5 text-xs p-2 rounded-lg"
              style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
              <AlertCircle size={11} />{error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SaveCancelRow({ onSave, onCancel, saving, value }) {
  return (
    <div className="flex gap-2">
      <button onClick={onCancel} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border flex-1 justify-center"
        style={{ borderColor: '#30363d', color: '#8b949e' }}>
        <X size={10} />Cancel
      </button>
      <button onClick={() => onSave(value)} disabled={saving}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium flex-1 justify-center"
        style={{ background: saving ? '#30363d' : 'linear-gradient(135deg,#f97316,#ea580c)', color: saving ? '#8b949e' : 'white', cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
        {saving ? 'Saving…' : 'Apply'}
      </button>
    </div>
  )
}

// ── specific editable cards ───────────────────────────────────────────────────

function TextEditInput({ init, onSave, onCancel, saving, placeholder, warning }) {
  const [val, setVal] = useState(init)
  return (
    <>
      {warning && <div className="flex items-center gap-1 text-xs mb-1" style={{ color: '#d29922' }}><AlertCircle size={11} />{warning}</div>}
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder} autoFocus
        className="w-full px-2 py-1.5 rounded-lg text-xs font-mono border outline-none"
        style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
        onFocus={e => e.target.style.borderColor = '#f97316'}
        onBlur={e => e.target.style.borderColor = '#30363d'}
        onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel() }} />
      <SaveCancelRow onSave={onSave} onCancel={onCancel} saving={saving} value={val} />
    </>
  )
}

function VersionCard({ namespace, name, detail, onRefresh }) {
  const save = async (tag) => {
    const repo = detail.image?.includes(':') ? detail.image.split(':').slice(0, -1).join(':') : (detail.image || 'docker-registry1.mariadb.com/library/mariadb')
    const res = await fetch(`/api/instances/${namespace}/${name}/image`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: `${repo}:${tag}` }) })
    const d = await res.json(); if (!res.ok) throw new Error(d.error)
    onRefresh()
  }
  return (
    <EditableMetaCard label="Version" icon={Database} accent="#58a6ff" displayValue={detail.version} onSave={save}>
      {(props) => <TextEditInput {...props} init={detail.version === '—' ? '' : detail.version} placeholder="e.g. 11.8.5" />}
    </EditableMetaCard>
  )
}

function StorageCard({ namespace, name, detail, onRefresh }) {
  const save = async (size) => {
    const res = await fetch(`/api/instances/${namespace}/${name}/storage-size`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size }) })
    const d = await res.json(); if (!res.ok) throw new Error(d.error)
    onRefresh()
  }
  return (
    <EditableMetaCard label="Storage" icon={HardDrive} accent="#bc8cff" displayValue={detail.storage} onSave={save}>
      {(props) => <TextEditInput {...props} init={detail.storage === '—' ? '' : detail.storage} placeholder="e.g. 20Gi" warning="Can only increase storage size" />}
    </EditableMetaCard>
  )
}

function StorageClassCard({ namespace, name, detail, onRefresh }) {
  const save = async (storageClassName) => {
    const res = await fetch(`/api/instances/${namespace}/${name}/storage-class`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storageClassName }) })
    const d = await res.json(); if (!res.ok) throw new Error(d.error)
    onRefresh()
  }
  return (
    <EditableMetaCard label="Storage Class" icon={HardDrive} accent="#8b949e" displayValue={detail.storageClass} onSave={save}>
      {(props) => <TextEditInput {...props} init={detail.storageClass === '—' ? '' : detail.storageClass} placeholder="e.g. standard" />}
    </EditableMetaCard>
  )
}

function ServiceTypeCard({ namespace, name, detail, onRefresh }) {
  const [val, setVal] = useState(detail.serviceType)
  const save = async (serviceType) => {
    const res = await fetch(`/api/instances/${namespace}/${name}/service-type`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serviceType }) })
    const d = await res.json(); if (!res.ok) throw new Error(d.error)
    onRefresh()
  }
  return (
    <EditableMetaCard label="Service Type" icon={Network} accent="#8b949e" displayValue={detail.serviceType} onSave={save}>
      {({ onSave, onCancel, saving }) => (
        <>
          <div className="relative">
            <select value={val} onChange={e => setVal(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs border outline-none appearance-none"
              style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
              onFocus={e => e.target.style.borderColor = '#f97316'}
              onBlur={e => e.target.style.borderColor = '#30363d'}>
              {['ClusterIP', 'NodePort', 'LoadBalancer'].map(t => <option key={t}>{t}</option>)}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8b949e' }} />
          </div>
          <SaveCancelRow onSave={onSave} onCancel={onCancel} saving={saving} value={val} />
        </>
      )}
    </EditableMetaCard>
  )
}

// ── resource presets ─────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Micro',  cpuRequest: '100m',  cpuLimit: '200m',  memRequest: '128Mi', memLimit: '256Mi' },
  { label: 'Small',  cpuRequest: '250m',  cpuLimit: '500m',  memRequest: '256Mi', memLimit: '512Mi' },
  { label: 'Medium', cpuRequest: '500m',  cpuLimit: '1000m', memRequest: '512Mi', memLimit: '1Gi'   },
  { label: 'Large',  cpuRequest: '1000m', cpuLimit: '2000m', memRequest: '1Gi',   memLimit: '2Gi'   },
]

function ResourcesCard({ namespace, name, resources, replicas, onSaved }) {
  const [editing, setEditing]   = useState(false)
  const [form, setForm]         = useState(resources)
  const [saving, setSaving]     = useState(false)
  const [result, setResult]     = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const applyPreset = p => setForm({ cpuRequest: p.cpuRequest, cpuLimit: p.cpuLimit, memRequest: p.memRequest, memLimit: p.memLimit })

  const save = async () => {
    setSaving(true); setResult(null)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}/resources`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult({ ok: true })
      setEditing(false)
      onSaved()
    } catch (e) {
      setResult({ ok: false, error: e.message })
    } finally {
      setSaving(false) }
  }

  const cancel = () => { setForm(resources); setEditing(false); setResult(null) }

  const Row = ({ label, reqKey, limKey }) => (
    <div className="grid grid-cols-3 items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: '#21262d' }}>
      <span className="text-sm" style={{ color: '#8b949e' }}>{label}</span>
      {editing ? (
        <>
          <input value={form[reqKey]} onChange={e => set(reqKey, e.target.value)} placeholder="e.g. 250m"
            className="px-2 py-1.5 rounded-lg text-xs font-mono border outline-none"
            style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
            onFocus={e => e.target.style.borderColor = '#f97316'}
            onBlur={e => e.target.style.borderColor = '#30363d'} />
          <input value={form[limKey]} onChange={e => set(limKey, e.target.value)} placeholder="e.g. 500m"
            className="px-2 py-1.5 rounded-lg text-xs font-mono border outline-none"
            style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
            onFocus={e => e.target.style.borderColor = '#f97316'}
            onBlur={e => e.target.style.borderColor = '#30363d'} />
        </>
      ) : (
        <>
          <span className="text-xs font-mono" style={{ color: form[reqKey] ? '#e6edf3' : '#484f58' }}>{form[reqKey] || '—'}</span>
          <span className="text-xs font-mono" style={{ color: form[limKey] ? '#e6edf3' : '#484f58' }}>{form[limKey] || '—'}</span>
        </>
      )}
    </div>
  )

  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader icon={Cpu} title="Resources" />
        {!editing ? (
          <button onClick={() => { setForm(resources); setEditing(true) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e' }}>
            <Pencil size={11} />Edit
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={cancel} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: '#30363d', color: '#8b949e' }}>
              <X size={11} />Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: saving ? '#30363d' : 'linear-gradient(135deg,#f97316,#ea580c)', color: saving ? '#8b949e' : 'white', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
        )}
      </div>

      {/* Presets (only in edit mode) */}
      {editing && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs" style={{ color: '#8b949e' }}>Presets:</span>
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className="text-xs px-2.5 py-1 rounded-lg border transition-colors"
              style={{ borderColor: '#30363d', color: '#8b949e' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e' }}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-3 gap-3 mb-1">
        <div />
        <div className="text-xs font-medium" style={{ color: '#8b949e' }}>Request</div>
        <div className="text-xs font-medium" style={{ color: '#8b949e' }}>Limit</div>
      </div>

      <Row label="CPU"    reqKey="cpuRequest" limKey="cpuLimit" />
      <Row label="Memory" reqKey="memRequest" limKey="memLimit" />

      {/* Total (request × replicas) */}
      {!editing && (form.cpuRequest || form.memRequest) && (
        <div className="mt-3 pt-3 border-t flex gap-4" style={{ borderColor: '#21262d' }}>
          <span className="text-xs" style={{ color: '#8b949e' }}>Cluster total ({replicas} replicas):</span>
          {form.cpuRequest && <span className="text-xs font-mono" style={{ color: '#f97316' }}>{form.cpuRequest} × {replicas} CPU req</span>}
          {form.memRequest && <span className="text-xs font-mono" style={{ color: '#bc8cff' }}>{form.memRequest} × {replicas} mem req</span>}
        </div>
      )}

      {/* Result banner */}
      {result && !result.ok && (
        <div className="mt-3 flex items-center gap-2 p-2 rounded-lg text-xs"
          style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
          <AlertCircle size={12} />{result.error}
        </div>
      )}
    </div>
  )
}

// ── tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: Database },
  { id: 'pods',        label: 'Pods',        icon: Box },
  { id: 'replication', label: 'Replication', icon: Activity },
  { id: 'services',    label: 'Services',    icon: Network },
  { id: 'tls',         label: 'TLS',         icon: Shield },
  // Every CRD (Database/User/Grant/Backup/...) lives inside a single "CRDs" tab with its
  // own secondary nav (see CrdsPanel below) instead of one top-level tab each — 9 extra
  // top-level tabs made the bar unusably long / horizontal-scroll-only. Deliberately not
  // called "Resources": the Overview tab already has a "Resources" card for CPU/memory
  // requests-limits, and reusing the word for something unrelated was confusing.
  { id: 'crds',        label: 'CRDs',         icon: Icons.Boxes },
  { id: 'events',      label: 'Events',      icon: Zap },
  { id: 'resilience',  label: 'Resilience',  icon: Icons.Flame },
]

function TabBar({ active, setActive, type }) {
  const visible = TABS.filter(t =>
    t.id !== 'replication' || type === 'Replication' || type === 'Galera'
  )
  return (
    <div className="flex items-center gap-1 border-b mb-6 flex-wrap" style={{ borderColor: '#21262d' }}>
      {visible.map(t => {
        const on = active === t.id
        const Icon = t.icon
        return (
          <button key={t.id} onClick={() => setActive(t.id)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex-shrink-0"
            style={{ borderColor: on ? '#f97316' : 'transparent', color: on ? '#f97316' : '#8b949e' }}>
            <Icon size={13} />{t.label}
          </button>
        )
      })}
    </div>
  )
}

// ── CRDs panel (secondary nav for the 9 CRD tabs) ───────────────────────────────

// "permissions" is a pseudo-kind: it renders PermissionsMatrix instead of the generic
// ResourceTab, sitting alongside (not replacing) the raw Users/Grants CRUD tabs — same
// underlying Grant CRs, just a matrix view instead of a flat list.
const CRDS_PANEL_TABS = ['permissions', ...INSTANCE_CRD_TABS]

function CrdsPanel({ namespace, instanceName, initialKind }) {
  const [kind, setKind] = useState(CRDS_PANEL_TABS.includes(initialKind) ? initialKind : 'permissions')
  const schema = kind === 'permissions' ? null : CRD_SCHEMAS[kind]

  return (
    <div>
      <div className="flex items-center flex-wrap gap-1.5 mb-5">
        {CRDS_PANEL_TABS.map(k => {
          const isPermissions = k === 'permissions'
          const Icon = isPermissions ? Icons.Grid3x3 : (Icons[CRD_SCHEMAS[k].icon] || Icons.Box)
          const label = isPermissions ? 'Permissions' : CRD_SCHEMAS[k].pluralLabel
          // Each CRD kind already carries its own identity color in crdSchemas.js (Database
          // blue, User green, Grant purple, Backup orange, …) but previously every tab lit up
          // identically orange when selected, hiding that identity. Selecting a tab now lights
          // it up in its own kind's color instead — inactive tabs stay neutral gray so the bar
          // doesn't turn into a rainbow at rest, only the active selection carries color.
          const accent = isPermissions ? '#8b949e' : CRD_SCHEMAS[k].accent
          const on = kind === k
          return (
            <button
              key={k} onClick={() => setKind(k)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: on ? accent + '1f' : 'transparent',
                borderColor: on ? accent : '#30363d',
                color: on ? accent : '#8b949e',
              }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = accent + '80' }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = '#30363d' }}
            >
              <Icon size={13} color={on ? accent : undefined} />{label}
            </button>
          )
        })}
      </div>
      {kind === 'permissions'
        ? <PermissionsMatrix namespace={namespace} instanceName={instanceName} />
        : <ResourceTab schema={schema} namespace={namespace} instanceName={instanceName} />}
    </div>
  )
}

// ── tab panels ────────────────────────────────────────────────────────────────

function HealthChecklist({ detail, namespace, name }) {
  const [hasScheduledBackup, setHasScheduledBackup] = useState(null) // null = loading

  useEffect(() => {
    fetch(`/api/crd/backup?namespace=${namespace}&ref=${name}&refField=mariaDbRef`)
      .then(r => r.json())
      .then(d => setHasScheduledBackup((d.items ?? []).some(b => b.spec?.schedule?.cron)))
      .catch(() => setHasScheduledBackup(false))
  }, [namespace, name])

  const isHA = detail.type !== 'Standalone' && detail.replicas > 1
  const targetVersion = getSettings().latestMariadbVersion
  const behind = isVersionBehind(detail.version, targetVersion)
  // Same "days until expiry" math and 30-day urgent threshold the TLS tab already uses per
  // cert (see TLSTab's daysLeft/expColor) — checks whichever of the server/client leaf certs
  // expires soonest, since either one lapsing breaks connections. Skipped entirely when TLS
  // isn't enabled (nothing to check, and "TLS encryption enabled" already covers that gap).
  const tlsCerts = [detail.tls?.serverCert, detail.tls?.clientCert].filter(Boolean)
  const tlsDaysLeft = tlsCerts.length
    ? Math.min(...tlsCerts.map(c => Math.floor((new Date(c.notAfter) - Date.now()) / 86400000)))
    : null
  const checks = [
    {
      label: 'Resource requests/limits set', ok: !!(detail.resources?.cpuLimit && detail.resources?.memLimit),
      why: 'Without limits, one noisy instance can starve others (or itself) on a shared node.',
    },
    {
      label: 'TLS encryption enabled', ok: detail.tlsEnabled,
      why: 'Client↔server traffic is in plaintext otherwise.',
    },
    ...(detail.tlsEnabled && tlsDaysLeft != null ? [{
      label: 'TLS certificate not expiring within 30 days', ok: tlsDaysLeft >= 30,
      why: tlsDaysLeft < 0
        ? `Certificate expired ${Math.abs(tlsDaysLeft)} day(s) ago — TLS connections may already be failing. See the TLS tab and rotate it.`
        : `Expires in ${tlsDaysLeft} day(s). See the TLS tab for which certificate and rotate it before it lapses.`,
    }] : []),
    {
      label: 'Scheduled (recurring) backup', ok: hasScheduledBackup,
      why: 'A one-off backup goes stale; only a cron schedule keeps you covered over time.',
      loading: hasScheduledBackup === null,
    },
    {
      label: 'High availability topology', ok: isHA,
      why: isHA ? null : 'Standalone / single-replica — a lost pod means downtime until it reschedules, with no automatic failover.',
    },
    {
      // Checks metricsReady (the exporter Deployment is actually up), not metricsEnabled
      // (just the spec flag) — the operator silently skips creating the exporter entirely
      // if the ServiceMonitor CRD isn't installed, so "enabled in spec" alone can be a lie.
      label: 'Monitoring connected (PMM or metrics)', ok: detail.pmmEnabled || detail.metricsReady,
      why: detail.pmmEnabled || detail.metricsReady ? null
        : detail.metricsEnabled
          ? 'Metrics is enabled in spec, but the exporter Pod isn\'t actually running — check the Events tab (a missing ServiceMonitor CRD is the usual cause).'
          : 'No visibility into query performance or resource pressure until something is already broken.',
    },
    {
      label: `Up to date (target: ${targetVersion})`, ok: !behind,
      why: `Running ${detail.version}, behind the version you set in Settings — missing whatever fixes landed since.`,
    },
  ]
  const loaded = checks.filter(c => !c.loading)
  const passed = loaded.filter(c => c.ok).length
  const scoreColor = passed === loaded.length ? '#3fb950' : passed >= loaded.length / 2 ? '#d29922' : '#f85149'

  return (
    // Raised surface (#1a2028, vs. the standard #161b22 card tone below it) — this is the
    // single widget on the Overview tab meant to grab attention first, so it gets the page's
    // "primary" elevation while the meta/feature/condition cards beneath it stay secondary.
    <div className="rounded-xl border p-4" style={{ background: '#1a2028', borderColor: '#21262d' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icons.HeartPulse size={16} color={scoreColor} />
          <h2 className="text-base font-semibold" style={{ color: '#e6edf3' }}>Config Health</h2>
        </div>
        <span className="text-xs font-mono px-2 py-0.5 rounded-full font-semibold" style={{ background: scoreColor + '22', color: scoreColor }}>
          {passed}/{loaded.length}
        </span>
      </div>
      <div className="space-y-1">
        {checks.map((c, i) => {
          // Rows that need attention carry real visual weight of their own — a tinted
          // background and colored left edge on the row, not just a differently-colored
          // icon — so the eye catches the problem without reading every line. Passing rows
          // recede (muted label, thin divider) so the contrast does the scanning for you.
          const attention = !c.loading && !c.ok
          return (
            <div key={c.label}
              className="flex items-start justify-between py-2 pl-2.5 pr-2 -mx-0.5 rounded-lg transition-colors"
              style={{
                background: attention ? 'rgba(210,153,34,0.08)' : 'transparent',
                borderLeft: `2px solid ${attention ? '#d29922' : 'transparent'}`,
                borderBottom: !attention && i < checks.length - 1 ? '1px solid #21262d' : 'none',
              }}>
              <div>
                <div className="flex items-center gap-2">
                  {c.loading
                    ? <Loader2 size={13} className="animate-spin" color="#8b949e" />
                    : c.ok ? <CheckCircle2 size={13} color="#3fb950" /> : <XCircle size={13} color="#d29922" />}
                  <span className="text-sm" style={{ color: attention ? '#e6edf3' : '#8b949e', fontWeight: attention ? 600 : 400 }}>{c.label}</span>
                </div>
                {attention && c.why && (
                  <p className="text-xs mt-1 ml-5" style={{ color: '#8b949e' }}>{c.why}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OverviewTab({ detail, namespace, name, onRefresh }) {
  const conditionColor = s => s === 'True' ? '#3fb950' : '#f85149'

  return (
    <div className="space-y-6">
      {/* Config health checklist */}
      <HealthChecklist detail={detail} namespace={namespace} name={name} />

      {/* Meta cards */}
      <div className="grid grid-cols-3 gap-3">

        {/* Version */}
        <VersionCard namespace={namespace} name={name} detail={detail} onRefresh={onRefresh} />

        {/* Replicas */}
        <ReplicaCard namespace={namespace} name={name} replicas={detail.replicas} onSaved={onRefresh} />

        {/* Storage (increase only) */}
        <StorageCard namespace={namespace} name={name} detail={detail} onRefresh={onRefresh} />

        {/* Storage Class */}
        <StorageClassCard namespace={namespace} name={name} detail={detail} onRefresh={onRefresh} />

        {/* Service Type */}
        <ServiceTypeCard namespace={namespace} name={name} detail={detail} onRefresh={onRefresh} />

        <MetaCard label="Age" value={detail.age} icon={Clock} accent="#8b949e" />
      </div>

      {/* Resources */}
      <ResourcesCard namespace={namespace} name={name}
        resources={detail.resources} replicas={detail.replicas} onSaved={onRefresh} />

      {/* Features */}
      <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <SectionHeader icon={Shield} title="Features" />
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'TLS Encryption',         ok: detail.tlsEnabled },
            { label: 'Metrics',                ok: detail.metricsEnabled },
            { label: 'Auto Failover',          ok: detail.autoFailover },
            { label: 'Semi-sync Replication',  ok: detail.semiSync },
          ].map(f => (
            <div key={f.label} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: '#21262d' }}>
              <span className="text-sm" style={{ color: '#8b949e' }}>{f.label}</span>
              <Pill ok={f.ok} label={f.ok ? 'Enabled' : 'Disabled'} />
            </div>
          ))}
          {detail.pmmEnabled && (
            <div className="col-span-2 py-2 border-t" style={{ borderColor: '#21262d' }}>
              <PmmLink address={detail.pmmServerAddress} instanceName={name} />
            </div>
          )}
        </div>
      </div>

      {/* Conditions */}
      <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <SectionHeader icon={Activity} title="Conditions" />
        <div className="space-y-2">
          {detail.conditions.map(c => (
            <div key={c.type} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: '#21262d' }}>
              <div className="flex items-center gap-2">
                {c.status === 'True'
                  ? <CheckCircle2 size={14} color="#3fb950" />
                  : <XCircle size={14} color="#f85149" />}
                <span className="text-sm font-medium" style={{ color: '#e6edf3' }}>{c.type}</span>
              </div>
              <span className="text-xs" style={{ color: '#8b949e' }}>{c.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const TAIL_OPTIONS = [100, 200, 500, 1000, 2000]

// Log viewer modal for a single pod. Container tabs come from the pod's own containers
// array (already fetched by PodsTab, no extra round trip needed to know what's available —
// e.g. mariadb/agent, plus pmm-client if PMM is enabled). Manual refresh only, no polling:
// this is "what does the log say right now", not a live tail, and re-fetching a few hundred
// lines every few seconds for something that might sit open a while isn't worth the load.
function LogsModal({ namespace, name, pod, onClose }) {
  const containerNames = pod.containers.map(c => c.name)
  const [container, setContainer] = useState(containerNames[0])
  const [tailLines, setTailLines] = useState(200)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const logRef = useRef(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}/pods/${pod.name}/logs?container=${container}&tailLines=${tailLines}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setLogs(data.logs)
    } catch (e) {
      setError(e.message)
      setLogs('')
    } finally {
      setLoading(false)
    }
  }, [namespace, name, pod.name, container, tailLines])

  useEffect(() => { fetchLogs() }, [fetchLogs])
  useEffect(() => {
    if (!loading && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [loading, logs])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-xl border flex flex-col"
        style={{ background: '#161b22', borderColor: '#21262d', height: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#21262d' }}>
          <div className="flex items-center gap-2 min-w-0">
            <Icons.ScrollText size={15} color="#8b949e" className="flex-shrink-0" />
            <h3 className="text-sm font-semibold font-mono truncate" style={{ color: '#e6edf3' }}>{pod.name}</h3>
          </div>
          <button onClick={onClose} style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b flex-shrink-0 flex-wrap" style={{ borderColor: '#21262d' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {containerNames.map(c => {
              const on = c === container
              return (
                <button
                  key={c} onClick={() => setContainer(c)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border transition-all"
                  style={{
                    background: on ? 'rgba(249,115,22,0.12)' : 'transparent',
                    borderColor: on ? '#f97316' : '#30363d',
                    color: on ? '#f97316' : '#8b949e',
                  }}
                >{c}</button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={tailLines} onChange={e => setTailLines(Number(e.target.value))}
              className="px-2 py-1 rounded-lg text-xs border" style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
            >
              {TAIL_OPTIONS.map(n => <option key={n} value={n}>Last {n} lines</option>)}
            </select>
            <button
              onClick={fetchLogs} disabled={loading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border"
              style={{ color: '#8b949e', borderColor: '#30363d', background: 'transparent', cursor: loading ? 'default' : 'pointer' }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4" ref={logRef}>
          {error ? (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
              <AlertCircle size={15} />{error}
            </div>
          ) : loading ? (
            <div className="text-center py-16">
              <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#f97316' }} />
            </div>
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words" style={{ color: '#c9d1d9' }}>
              {logs || 'No log output.'}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

function PodsTab({ namespace, name, primary }) {
  const [pods, setPods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [logsTarget, setLogsTarget] = useState(null)

  useEffect(() => {
    fetch(`/api/instances/${namespace}/${name}/pods`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setPods(d.pods) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [namespace, name])

  if (loading) return <Spinner />
  if (error)   return <ErrorMsg msg={error} />

  const roleColor = r => r === 'Primary' ? '#f97316' : r === 'Replica' ? '#58a6ff' : '#8b949e'
  const roleBg    = r => r === 'Primary' ? 'rgba(249,115,22,0.12)' : r === 'Replica' ? 'rgba(88,166,255,0.12)' : 'rgba(139,148,158,0.1)'

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid #21262d' }}>
            {['Pod', 'Role', 'Phase', 'Ready', 'Restarts', 'Pod IP', 'Node', 'Age', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pods.map((pod, i) => (
            <tr key={pod.name} style={{ borderBottom: i < pods.length - 1 ? '1px solid #21262d' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td className="px-4 py-3 text-xs font-mono" style={{ color: pod.name === primary ? '#f97316' : '#e6edf3' }}>
                {pod.name}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: roleBg(pod.role), color: roleColor(pod.role) }}>
                  {pod.role}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="text-xs" style={{ color: pod.phase === 'Running' ? '#3fb950' : '#d29922' }}>{pod.phase}</span>
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: pod.ready.startsWith(pod.ready.split('/')[1]) ? '#3fb950' : '#d29922' }}>
                {pod.ready}
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: pod.restarts > 0 ? '#d29922' : '#8b949e' }}>{pod.restarts}</td>
              <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{pod.podIP}</td>
              <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{pod.node}</td>
              <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{pod.age}</td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => setLogsTarget(pod)}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ml-auto"
                  style={{ color: '#8b949e', borderColor: '#30363d', background: 'transparent', cursor: 'pointer' }}
                >
                  <Icons.ScrollText size={12} />
                  Logs
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {logsTarget && (
        <LogsModal namespace={namespace} name={name} pod={logsTarget} onClose={() => setLogsTarget(null)} />
      )}
    </div>
  )
}

function ReplicationTopologyDiagram({ detail }) {
  const roles    = detail.replication?.roles ?? {}
  const replicas = detail.replication?.replicas ?? {}
  const primaryPod  = Object.entries(roles).find(([, r]) => r === 'Primary')?.[0]
  const replicaPods = Object.entries(roles).filter(([, r]) => r !== 'Primary').map(([pod]) => pod)

  if (!primaryPod) return null

  return (
    <div className="rounded-xl border p-5" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center gap-6">
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <div className="w-24 h-16 rounded-xl border-2 flex flex-col items-center justify-center" style={{ borderColor: '#f97316', background: 'rgba(249,115,22,0.1)' }}>
            <Icons.Crown size={16} color="#f97316" />
            <span className="text-[10px] font-mono mt-1 truncate max-w-[88px]" style={{ color: '#e6edf3' }}>{primaryPod}</span>
          </div>
          <span className="text-[10px] font-medium" style={{ color: '#f97316' }}>PRIMARY</span>
        </div>

        <div className="flex-1 flex flex-col gap-3">
          {replicaPods.length === 0 && <span className="text-xs" style={{ color: '#8b949e' }}>No replicas.</span>}
          {replicaPods.map(pod => {
            const r = replicas[pod]
            const healthy = r?.slaveIORunning && r?.slaveSQLRunning
            const lag = r?.secondsBehindMaster
            return (
              <div key={pod} className="flex items-center gap-3">
                <svg width="40" height="24" style={{ flexShrink: 0 }}>
                  <line x1="0" y1="12" x2="34" y2="12" stroke={healthy ? '#3fb950' : '#f85149'} strokeWidth="2" strokeDasharray={healthy ? '' : '3,3'} />
                  <polygon points="34,7 40,12 34,17" fill={healthy ? '#3fb950' : '#f85149'} />
                </svg>
                <div className="flex-1 flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: '#30363d', background: '#0d1117' }}>
                  <span className="text-xs font-mono" style={{ color: '#e6edf3' }}>{pod}</span>
                  <div className="flex items-center gap-3">
                    <Pill ok={r?.slaveIORunning} label="IO" />
                    <Pill ok={r?.slaveSQLRunning} label="SQL" />
                    <span className="text-xs font-mono" style={{ color: lag > 0 ? '#d29922' : '#3fb950' }}>{lag ?? '—'}s lag</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GaleraTopologyDiagram({ namespace, name, detail }) {
  const [pods, setPods] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/instances/${namespace}/${name}/pods`)
      .then(r => r.json())
      .then(d => setPods(d.pods ?? []))
      .finally(() => setLoading(false))
  }, [namespace, name])

  if (loading) return <Spinner />
  if (!pods.length) return <p className="text-sm" style={{ color: '#8b949e' }}>No pods found.</p>

  const size = 260, center = size / 2, radius = 95, nodeW = 96, nodeH = 40
  const positions = pods.map((p, i) => {
    const angle = (2 * Math.PI * i) / pods.length - Math.PI / 2
    return { pod: p, x: center + radius * Math.cos(angle) - nodeW / 2, y: center + radius * Math.sin(angle) - nodeH / 2 }
  })

  return (
    <div className="rounded-xl border p-5" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <p className="text-xs mb-4" style={{ color: '#8b949e' }}>
        Physical cluster membership from the Pods API — Galera doesn't expose per-node wsrep state (cluster size, local state) through
        the MariaDB CR's status, only which pod is currently the write-primary.
      </p>
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <div className="absolute rounded-full border" style={{ inset: (size - 2 * radius - nodeH) / 2, borderColor: '#30363d', borderStyle: 'dashed' }} />
        {positions.map(({ pod, x, y }) => {
          const isPrimary = pod.name === detail.primary
          const healthy = pod.phase === 'Running'
          return (
            <div key={pod.name} className="absolute flex flex-col items-center justify-center rounded-xl border-2 px-2"
              style={{
                left: x, top: y, width: nodeW, height: nodeH,
                borderColor: isPrimary ? '#f97316' : healthy ? '#30363d' : '#f85149',
                background: isPrimary ? 'rgba(249,115,22,0.1)' : '#0d1117',
              }}>
              <span className="text-[10px] font-mono truncate max-w-full" style={{ color: '#e6edf3' }}>{pod.name}</span>
              <span className="text-[9px]" style={{ color: isPrimary ? '#f97316' : healthy ? '#3fb950' : '#f85149' }}>
                {isPrimary ? 'PRIMARY' : healthy ? 'member' : pod.phase}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// On-demand (not auto-refreshed) schema/version consistency check across every pod of this
// instance — each pod needs its own `kubectl exec` round trip, unlike the rest of this API
// which reads cheaply from the k8s API server, so this only runs when asked. Structural
// comparison only (table/column names+types via information_schema, hashed), not row data.
function SchemaConsistencyCheck({ namespace, name }) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const runCheck = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}/schema-check`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const reference = result?.pods.find(p => p.pod === result.referencePod)

  return (
    <div className="rounded-xl border p-5" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icons.GitCompare size={16} color="#bc8cff" />
          <h3 className="text-base font-semibold" style={{ color: '#e6edf3' }}>Schema Consistency</h3>
        </div>
        <button
          onClick={runCheck} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{
            background: 'rgba(188,140,255,0.12)', color: '#bc8cff', border: '1px solid rgba(188,140,255,0.35)',
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Icons.GitCompare size={13} />}
          {loading ? 'Checking…' : (result ? 'Check again' : 'Check now')}
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: '#8b949e' }}>
        Runs an information_schema query on every pod (via kubectl exec) to verify they report the same MariaDB version and
        an identical table/column structure. Compares schema shape, not row data.
      </p>

      {error && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg mb-3 text-xs" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
          <AlertCircle size={13} />{error}
        </div>
      )}

      {result && result.pods.length > 0 && (
        <>
          <div className="flex items-center gap-4 mb-3">
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: result.schemaConsistent ? '#3fb950' : '#f85149' }}>
              {result.schemaConsistent ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              Schema {result.schemaConsistent ? 'consistent' : 'DIVERGED'}
            </span>
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: result.versionConsistent ? '#3fb950' : '#d29922' }}>
              {result.versionConsistent ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              Version {result.versionConsistent ? 'consistent' : 'mismatched'}
            </span>
          </div>
          <div className="rounded-lg border overflow-x-auto" style={{ borderColor: '#21262d' }}>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #21262d' }}>
                  {['Pod', 'Version', 'Tables', 'Schema hash', 'Error'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider whitespace-nowrap" style={{ color: '#8b949e' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.pods.map((p, i) => {
                  const schemaMatch = !p.error && p.schemaHash === reference?.schemaHash
                  const versionMatch = !p.error && p.version === reference?.version
                  return (
                    <tr key={p.pod} style={{ borderBottom: i < result.pods.length - 1 ? '1px solid #21262d' : 'none' }}>
                      <td className="px-3 py-2 text-xs font-mono whitespace-nowrap" style={{ color: '#e6edf3' }}>
                        {p.pod}
                        {p.pod === result.referencePod && <span className="ml-1.5 text-[9px]" style={{ color: '#8b949e' }}>(reference)</span>}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono whitespace-nowrap" style={{ color: p.error ? '#8b949e' : versionMatch ? '#e6edf3' : '#d29922' }}>
                        {p.version ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono" style={{ color: '#8b949e' }}>{p.tableCount ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-mono whitespace-nowrap" style={{ color: p.error ? '#8b949e' : schemaMatch ? '#3fb950' : '#f85149' }} title={p.schemaHash ?? ''}>
                        {p.schemaHash ? p.schemaHash.slice(0, 12) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: '#f85149' }}>{p.error || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function ReplicationTab({ namespace, name, detail }) {
  if (detail.type === 'Galera') {
    return (
      <div className="space-y-4">
        <GaleraTopologyDiagram namespace={namespace} name={name} detail={detail} />
        <SchemaConsistencyCheck namespace={namespace} name={name} />
      </div>
    )
  }

  const replicas = detail.replication?.replicas ?? {}
  const roles    = detail.replication?.roles ?? {}

  if (!detail.replication) {
    return <p className="text-sm" style={{ color: '#8b949e' }}>No replication data available.</p>
  }

  const pods = Object.entries(roles)

  return (
    <div className="space-y-4">
      <ReplicationTopologyDiagram detail={detail} />
      <SchemaConsistencyCheck namespace={namespace} name={name} />

      {/* Role summary */}
      <div className="flex gap-3">
        {pods.map(([pod, role]) => (
          <div key={pod} className="flex-1 rounded-xl border p-3" style={{ background: '#161b22', borderColor: role === 'Primary' ? 'rgba(249,115,22,0.4)' : '#21262d' }}>
            <div className="text-xs font-mono mb-1 truncate" style={{ color: '#8b949e' }}>{pod}</div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: role === 'Primary' ? 'rgba(249,115,22,0.15)' : 'rgba(88,166,255,0.12)', color: role === 'Primary' ? '#f97316' : '#58a6ff' }}>
              {role}
            </span>
          </div>
        ))}
      </div>

      {/* Replica detail table */}
      {Object.keys(replicas).length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                {['Replica', 'IO Running', 'SQL Running', 'Lag (s)', 'GTID IO Pos', 'GTID Current'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(replicas).map(([pod, r], i, arr) => (
                <tr key={pod} style={{ borderBottom: i < arr.length - 1 ? '1px solid #21262d' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: '#e6edf3' }}>{pod}</td>
                  <td className="px-4 py-3"><Pill ok={r.slaveIORunning}  label={r.slaveIORunning  ? 'Yes' : 'No'} /></td>
                  <td className="px-4 py-3"><Pill ok={r.slaveSQLRunning} label={r.slaveSQLRunning ? 'Yes' : 'No'} /></td>
                  <td className="px-4 py-3 text-xs" style={{ color: r.secondsBehindMaster > 0 ? '#d29922' : '#3fb950' }}>
                    {r.secondsBehindMaster}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{r.gtidIOPos || '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{r.gtidCurrentPos || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Errors if any */}
          {Object.entries(replicas).map(([pod, r]) =>
            (r.lastIOError || r.lastSQLError) ? (
              <div key={pod} className="px-4 py-2 border-t text-xs" style={{ borderColor: '#21262d', color: '#f85149' }}>
                <span className="font-mono">{pod}</span>: {r.lastIOError || r.lastSQLError}
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  )
}

function ServicesTab({ namespace, name }) {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`/api/instances/${namespace}/${name}/services`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setServices(d.services) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [namespace, name])

  if (loading) return <Spinner />
  if (error)   return <ErrorMsg msg={error} />

  const roleOf = svcName => {
    if (svcName.endsWith('-primary'))   return 'Primary'
    if (svcName.endsWith('-secondary')) return 'Secondary'
    if (svcName.endsWith('-internal'))  return 'Internal'
    return 'All'
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid #21262d' }}>
            {['Service', 'Role', 'Type', 'Cluster IP', 'Ports', 'Endpoints'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {services.map((svc, i) => (
            <tr key={svc.name} style={{ borderBottom: i < services.length - 1 ? '1px solid #21262d' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td className="px-4 py-3 text-sm font-medium" style={{ color: '#58a6ff' }}>{svc.name}</td>
              <td className="px-4 py-3">
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#1c2330', color: '#8b949e', border: '1px solid #30363d' }}>
                  {roleOf(svc.name)}
                </span>
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: '#e6edf3' }}>{svc.type}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-mono" style={{ color: '#8b949e' }}>{svc.clusterIP}</span>
                  {svc.clusterIP !== 'None' && svc.clusterIP !== '—' && <CopyButton text={svc.clusterIP} />}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {svc.ports.map(p => (
                    <span key={p.port} className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(88,166,255,0.1)', color: '#58a6ff' }}>
                      {p.port}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const { endpointsReady: ready, endpointsTotal: total } = svc
                  // 0/0 (no backends registered at all, e.g. a fresh -primary Service before
                  // the operator has pointed it anywhere yet) reads differently from N/0 out
                  // of M expected — the latter means something's actually down.
                  const color = total === 0 ? '#8b949e' : ready === total ? '#3fb950' : ready === 0 ? '#f85149' : '#d29922'
                  return (
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full" style={{ background: color + '22', color }}>
                      {ready}/{total} ready
                    </span>
                  )
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TLSTab({ tls, tlsEnabled }) {
  if (!tlsEnabled || !tls) {
    return (
      <div className="rounded-xl border p-8 text-center" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <Shield size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
        <p className="text-sm" style={{ color: '#8b949e' }}>TLS is not enabled for this instance.</p>
      </div>
    )
  }

  const certs = [
    { label: 'CA Bundle',    cert: tls.caBundle?.[0] },
    { label: 'Server Cert',  cert: tls.serverCert },
    { label: 'Client Cert',  cert: tls.clientCert },
  ].filter(c => c.cert)

  const daysLeft = (dateStr) => {
    const d = Math.floor((new Date(dateStr) - Date.now()) / 86400000)
    return d
  }

  return (
    <div className="space-y-3">
      {certs.map(({ label, cert }) => {
        const days = daysLeft(cert.notAfter)
        const expColor = days < 30 ? '#f85149' : days < 90 ? '#d29922' : '#3fb950'
        return (
          <div key={label} className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={14} color="#58a6ff" />
                <span className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{label}</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: expColor + '22', color: expColor }}>
                {days}d until expiry
              </span>
            </div>
            <div className="space-y-1.5 text-xs font-mono" style={{ color: '#8b949e' }}>
              <div><span style={{ color: '#8b949e' }}>Subject: </span><span style={{ color: '#e6edf3' }}>{cert.subject}</span></div>
              <div><span style={{ color: '#8b949e' }}>Issuer:  </span><span style={{ color: '#e6edf3' }}>{cert.issuer}</span></div>
              <div><span style={{ color: '#8b949e' }}>Valid:   </span><span style={{ color: '#e6edf3' }}>{cert.notBefore?.slice(0,10)} → {cert.notAfter?.slice(0,10)}</span></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EventsTab({ namespace, name }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    fetch(`/api/instances/${namespace}/${name}/events`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setEvents(d.events) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [namespace, name])

  if (loading) return <Spinner />
  if (error)   return <ErrorMsg msg={error} />
  if (!events.length) {
    return (
      <div className="text-center py-12">
        <Zap size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
        <p className="text-sm" style={{ color: '#8b949e' }}>No recent events.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid #21262d' }}>
            {['Type', 'Reason', 'Object', 'Message', 'Count', 'Last Seen'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {events.map((ev, i) => (
            <tr key={i} style={{ borderBottom: i < events.length - 1 ? '1px solid #21262d' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td className="px-4 py-3">
                <span className="text-xs font-medium" style={{ color: ev.type === 'Warning' ? '#d29922' : '#3fb950' }}>
                  {ev.type}
                </span>
              </td>
              <td className="px-4 py-3 text-xs font-medium" style={{ color: '#e6edf3' }}>{ev.reason}</td>
              <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{ev.object}</td>
              <td className="px-4 py-3 text-xs max-w-xs" style={{ color: '#8b949e' }}>
                <span className="line-clamp-2">{ev.message}</span>
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{ev.count}</td>
              <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#8b949e' }}>
                {ev.lastTime ? new Date(ev.lastTime).toLocaleTimeString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── resilience tab: chaos pod-delete drill + backup restore drill ──────────────

function ConfirmModal({ title, description, confirmWord, actionLabel, danger = true, busy, error, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const confirmed = typed === confirmWord
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded-2xl border p-6 w-full max-w-md mx-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: danger ? 'rgba(248,81,73,0.15)' : 'rgba(249,115,22,0.15)' }}>
            <Icons.AlertTriangle size={20} color={danger ? '#f85149' : '#f97316'} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{title}</h3>
            <p className="text-xs mt-0.5" style={{ color: '#8b949e' }}>{description}</p>
          </div>
        </div>
        <div className="mb-5">
          <label className="text-xs mb-1.5 block" style={{ color: '#8b949e' }}>
            Type <span style={{ color: '#e6edf3', fontWeight: 600 }}>{confirmWord}</span> to confirm
          </label>
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={confirmWord} autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors"
            style={{ background: '#0d1117', borderColor: confirmed ? (danger ? '#f85149' : '#f97316') : '#30363d', color: '#e6edf3' }}
            onKeyDown={e => e.key === 'Enter' && confirmed && !busy && onConfirm()} />
        </div>
        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg mb-4 text-xs" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
            <AlertCircle size={13} />{error}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 rounded-lg text-sm border" style={{ background: 'transparent', borderColor: '#30363d', color: '#8b949e' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!confirmed || busy}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: confirmed && !busy ? (danger ? 'rgba(248,81,73,0.9)' : 'rgba(249,115,22,0.9)') : '#21262d',
              color: confirmed && !busy ? 'white' : '#8b949e',
              cursor: confirmed && !busy ? 'pointer' : 'not-allowed',
            }}>
            {busy ? <><Loader2 size={13} className="animate-spin" />Working…</> : <>{actionLabel}</>}
          </button>
        </div>
      </div>
    </div>
  )
}

function LogLine({ entry }) {
  const color = entry.kind === 'done' ? '#3fb950' : entry.kind === 'action' ? '#f97316' : '#8b949e'
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      <span className="font-mono flex-shrink-0" style={{ color: '#484f58' }}>{entry.t.toLocaleTimeString()}</span>
      <span style={{ color }}>{entry.msg}</span>
    </div>
  )
}

function PodFailoverDrill({ namespace, name, detail, onRefreshDetail }) {
  const [pods, setPods] = useState([])
  const [selectedPod, setSelectedPod] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [log, setLog] = useState([])
  const [startedAt, setStartedAt] = useState(null)
  const pollRef = useRef(null)
  const lastPhaseRef = useRef(null)
  const lastPrimaryRef = useRef(null)
  const lastEventTimeRef = useRef(null)
  const ticksRef = useRef(0)

  const fetchPods = useCallback(() => {
    return fetch(`/api/instances/${namespace}/${name}/pods`).then(r => r.json())
      .then(d => { if (!d.error) setPods(d.pods); return d.pods ?? [] })
      .catch(() => [])
  }, [namespace, name])

  useEffect(() => {
    fetchPods().then(p => {
      if (p.length && !selectedPod) setSelectedPod(p.some(x => x.name === detail.primary) ? detail.primary : p[0].name)
    })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPods])

  const append = (msg, kind = 'info') => setLog(l => [...l, { t: new Date(), msg, kind }])

  const startDrill = async () => {
    const deletedPod = selectedPod
    const wasPrimary = deletedPod === detail.primary
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}/chaos/delete-pod`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ podName: deletedPod }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)

      setConfirming(false); setRunning(true)
      setStartedAt(Date.now())
      lastPhaseRef.current = null; lastPrimaryRef.current = detail.primary; lastEventTimeRef.current = new Date().toISOString(); ticksRef.current = 0
      setLog([{ t: new Date(), msg: `Deleted pod ${deletedPod}${wasPrimary ? ' — this was the primary' : ''}. Watching recovery…`, kind: 'action' }])

      pollRef.current = setInterval(async () => {
        ticksRef.current += 1
        try {
          const [podsD, detD, evD] = await Promise.all([
            fetch(`/api/instances/${namespace}/${name}/pods`).then(r => r.json()),
            fetch(`/api/instances/${namespace}/${name}`).then(r => r.json()),
            fetch(`/api/instances/${namespace}/${name}/events`).then(r => r.json()),
          ])
          setPods(podsD.pods ?? [])
          const target = (podsD.pods ?? []).find(p => p.name === deletedPod)
          if (target && target.phase !== lastPhaseRef.current) {
            append(`${deletedPod} → phase ${target.phase} (${target.ready} ready, ${target.restarts} restarts)`)
            lastPhaseRef.current = target.phase
          }
          if (detD.primary && detD.primary !== lastPrimaryRef.current) {
            append(`Primary changed: ${lastPrimaryRef.current} → ${detD.primary}`)
            lastPrimaryRef.current = detD.primary
          }
          for (const ev of (evD.events ?? [])) {
            if (ev.lastTime && ev.lastTime > lastEventTimeRef.current) {
              append(`Event (${ev.type}/${ev.reason}): ${ev.message}`)
            }
          }
          if (evD.events?.length) {
            const newest = evD.events.reduce((a, b) => (a.lastTime > b.lastTime ? a : b))
            if (newest.lastTime) lastEventTimeRef.current = newest.lastTime
          }

          const targetReady = target && target.phase === 'Running' && target.ready.split('/')[0] === target.ready.split('/')[1]
          const primarySettled = !wasPrimary || (detD.primary && detD.status === 'Running')
          const timedOut = ticksRef.current > 45 // ~90s at 2s/tick

          if ((targetReady && primarySettled) || timedOut) {
            clearInterval(pollRef.current); pollRef.current = null
            setRunning(false)
            append(
              timedOut ? 'Stopped watching after 90s — instance may still be recovering, check the Pods/Events tabs.'
                       : `Recovery complete in ${Math.round((Date.now() - startedAt) / 1000)}s.`,
              timedOut ? 'info' : 'done'
            )
            onRefreshDetail()
          }
        } catch { /* transient fetch error mid-recovery — keep polling */ }
      }, 2000)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <SectionHeader icon={Icons.Flame} title="Pod Failover Drill" accent="#f97316" />
      <p className="text-xs mb-4" style={{ color: '#8b949e' }}>
        Delete a pod on purpose and watch {detail.type === 'Standalone' ? 'the StatefulSet recreate it' : 'the operator fail over / recover'} in real time.
        {detail.type === 'Standalone' && ' This instance is Standalone, so there is no primary to reassign — this only proves the pod comes back on its own.'}
      </p>

      {!running && (
        <>
          <div className="flex items-center flex-wrap gap-2 mb-4">
            {pods.map(p => (
              <button key={p.name} onClick={() => setSelectedPod(p.name)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all"
                style={{
                  background: selectedPod === p.name ? 'rgba(249,115,22,0.12)' : 'transparent',
                  borderColor: selectedPod === p.name ? '#f97316' : '#30363d',
                  color: selectedPod === p.name ? '#f97316' : '#8b949e',
                }}>
                {p.name}{p.name === detail.primary && <span className="text-[10px] opacity-80">(primary)</span>}
              </button>
            ))}
            {!pods.length && <span className="text-xs" style={{ color: '#8b949e' }}>Loading pods…</span>}
          </div>
          <button onClick={() => setConfirming(true)} disabled={!selectedPod}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.35)' }}>
            <Icons.Skull size={14} />Delete {selectedPod || 'pod'}
          </button>
        </>
      )}

      {(running || log.length > 0) && (
        <div className="rounded-lg border p-3 mt-2" style={{ background: '#0d1117', borderColor: '#21262d', maxHeight: 260, overflowY: 'auto' }}>
          {log.map((entry, i) => <LogLine key={i} entry={entry} />)}
          {running && (
            <div className="flex items-center gap-2 pt-1" style={{ color: '#8b949e' }}>
              <Loader2 size={12} className="animate-spin" /><span className="text-xs">Watching…</span>
            </div>
          )}
        </div>
      )}
      {!running && log.length > 0 && (
        <button onClick={() => { setLog([]); fetchPods() }} className="text-xs mt-3" style={{ color: '#58a6ff', background: 'none', border: 'none', cursor: 'pointer' }}>
          Run another drill
        </button>
      )}

      {confirming && (
        <ConfirmModal
          title="Delete this pod?"
          description={`This will run "kubectl delete pod ${selectedPod}" against the live instance. It should recover on its own — that's the point of the drill — but treat it like the production disruption it actually is.`}
          confirmWord={selectedPod}
          actionLabel={<><Icons.Skull size={13} />Delete pod</>}
          busy={busy}
          error={error}
          onCancel={() => { setConfirming(false); setError(null) }}
          onConfirm={startDrill}
        />
      )}
    </div>
  )
}

function RestoreDrill({ namespace, name }) {
  const drillName = `${name}-drill`
  const [backups, setBackups] = useState([])
  const [selectedBackup, setSelectedBackup] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [drill, setDrill] = useState(null) // null=none, 'loading', or detail object
  const pollRef = useRef(null)

  useEffect(() => {
    fetch(`/api/crd/backup?namespace=${namespace}&ref=${name}&refField=mariaDbRef`)
      .then(r => r.json())
      .then(d => setBackups(d.items ?? []))
      .catch(() => {})
  }, [namespace, name])

  const checkDrill = useCallback(async () => {
    try {
      const res = await fetch(`/api/instances/${namespace}/${drillName}`)
      if (!res.ok) { setDrill(null); return null }
      const d = await res.json()
      setDrill(d)
      return d
    } catch { setDrill(null); return null }
  }, [namespace, drillName])

  useEffect(() => {
    checkDrill()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [checkDrill])

  const startDrill = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}/restore-drill`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupName: selectedBackup }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setConfirming(false)
      setDrill('loading')
      pollRef.current = setInterval(async () => {
        const d2 = await checkDrill()
        if (d2 && (d2.status === 'Running' || (d2.statusMessage || '').length)) {
          // keep polling until Running or until it's been failing for a while — the modal
          // has no server-side timeout, so this is a soft "poll forever while the tab is open"
        }
        if (d2 && d2.status === 'Running') { clearInterval(pollRef.current); pollRef.current = null }
      }, 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const cleanup = async () => {
    setBusy(true)
    try {
      await fetch(`/api/instances/${namespace}/${name}/restore-drill`, { method: 'DELETE' })
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setDrill(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <SectionHeader icon={Icons.ShieldCheck} title="Backup Restore Drill" accent="#58a6ff" />
      <p className="text-xs mb-4" style={{ color: '#8b949e' }}>
        Prove a backup is actually restorable: spins up a throwaway instance (<code>{drillName}</code>) bootstrapped from it,
        in this same namespace. Nothing about your real instance is touched. Delete the drill instance when you're done looking at it.
      </p>

      {!drill && (
        <>
          {backups.length === 0 ? (
            <p className="text-xs" style={{ color: '#8b949e' }}>No Backup resources found for this instance yet — create one in the CRDs tab first.</p>
          ) : (
            <>
              <div className="flex items-center flex-wrap gap-2 mb-4">
                {backups.map(b => {
                  const complete = b.status?.conditions?.some(c => c.type === 'Complete' && c.status === 'True')
                  return (
                    <button key={b.name} onClick={() => setSelectedBackup(b.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all"
                      style={{
                        background: selectedBackup === b.name ? 'rgba(88,166,255,0.12)' : 'transparent',
                        borderColor: selectedBackup === b.name ? '#58a6ff' : '#30363d',
                        color: selectedBackup === b.name ? '#58a6ff' : '#8b949e',
                      }}>
                      {b.name}
                      {complete ? <CheckCircle2 size={11} color="#3fb950" /> : <Icons.Clock3 size={11} />}
                    </button>
                  )
                })}
              </div>
              <button onClick={() => setConfirming(true)} disabled={!selectedBackup}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'rgba(88,166,255,0.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,0.35)' }}>
                <Icons.PlayCircle size={14} />Run restore drill
              </button>
            </>
          )}
        </>
      )}

      {drill === 'loading' && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#8b949e' }}>
          <Loader2 size={13} className="animate-spin" />Creating {drillName}…
        </div>
      )}

      {drill && drill !== 'loading' && (
        <div className="rounded-lg border p-3" style={{ background: '#0d1117', borderColor: '#21262d' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-mono" style={{ color: '#e6edf3' }}>{drillName}</span>
            <StatusBadge status={drill.status} small />
          </div>
          {drill.statusMessage && <p className="text-xs mb-3" style={{ color: '#8b949e' }}>{drill.statusMessage}</p>}
          {drill.status === 'Running' && (
            <p className="text-xs mb-3" style={{ color: '#3fb950' }}>
              Restore succeeded — this instance booted from the backup and is Ready. The backup is good.
            </p>
          )}
          <button onClick={cleanup} disabled={busy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(248,81,73,0.12)', color: '#f85149', border: '1px solid rgba(248,81,73,0.35)' }}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Icons.Trash2 size={12} />}Delete drill instance
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmModal
          title="Run a restore drill?"
          description={`Creates a new MariaDB instance "${drillName}" in namespace "${namespace}", bootstrapped from backup "${selectedBackup}". You'll need to delete it yourself when done.`}
          confirmWord={drillName}
          actionLabel={<><Icons.PlayCircle size={13} />Run drill</>}
          danger={false}
          busy={busy}
          error={error}
          onCancel={() => { setConfirming(false); setError(null) }}
          onConfirm={startDrill}
        />
      )}
    </div>
  )
}

function ResilienceTab({ namespace, name, detail, onRefreshDetail }) {
  return (
    <div className="space-y-4">
      <PodFailoverDrill namespace={namespace} name={name} detail={detail} onRefreshDetail={onRefreshDetail} />
      <RestoreDrill namespace={namespace} name={name} />
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function InstanceDetail({ instanceKey, setPage }) {
  const { namespace, name, tab: initialTab, crdKind: initialCrdKind } = instanceKey
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [tab, setTab]       = useState(initialTab || 'overview')
  const [refreshing, setRefreshing] = useState(false)

  const fetchDetail = useCallback(async (spinner = false) => {
    if (spinner) setRefreshing(true)
    try {
      const res = await fetch(`/api/instances/${namespace}/${name}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDetail(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [namespace, name])

  const { count, reset, total, paused, togglePause } = useAutoRefresh(fetchDetail)

  useEffect(() => { fetchDetail() }, [fetchDetail])

  return (
    <div className="px-8 py-8 max-w-[1800px] mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm" style={{ color: '#8b949e' }}>
        <button onClick={() => setPage('dashboard')}
          className="hover:text-white transition-colors" style={{ color: '#8b949e' }}>
          Instances
        </button>
        <span>/</span>
        <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1c2330', color: '#8b949e', border: '1px solid #30363d' }}>
          {namespace}
        </span>
        <span>/</span>
        <span style={{ color: '#e6edf3' }}>{name}</span>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorMsg msg={error} />
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <button onClick={() => setPage('dashboard')}
                className="flex items-center justify-center w-8 h-8 rounded-lg border transition-colors flex-shrink-0"
                style={{ borderColor: '#30363d', color: '#8b949e' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#8b949e'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#30363d'}>
                <ArrowLeft size={15} />
              </button>
              {/* Page-title icon, same blue/treatment as the Instances table links on the
                  Dashboard — a modestly larger, bolder icon than the 11-15px ones used
                  everywhere else, marking this as the page's identity rather than a detail. */}
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
                style={{ background: 'rgba(88,166,255,0.12)', borderColor: 'rgba(88,166,255,0.3)' }}>
                <Database size={20} color="#58a6ff" strokeWidth={2.25} />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>{name}</h1>
                  <StatusBadge status={detail.status} small />
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }}>
                    {detail.type}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs" style={{ color: '#8b949e' }}>
                  <span className="flex items-center gap-1"><Database size={11} />{detail.version}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Server size={11} />{detail.replicas} replicas</span>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Clock size={11} />{detail.age}</span>
                  <span>·</span>
                  <span>Primary: <span className="font-mono" style={{ color: '#e6edf3' }}>{detail.primary}</span></span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#30363d' }}>
              <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
              <button
                onClick={() => { fetchDetail(true); reset() }}
                disabled={refreshing}
                className="flex items-center gap-1.5 text-sm transition-colors"
                style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {/* Tabs */}
          <TabBar active={tab} setActive={setTab} type={detail.type} />

          {/* Tab content */}
          {tab === 'overview'    && <OverviewTab detail={detail} namespace={namespace} name={name} onRefresh={() => fetchDetail(true)} />}
          {tab === 'pods'        && <PodsTab namespace={namespace} name={name} primary={detail.primary} />}
          {tab === 'replication' && <ReplicationTab namespace={namespace} name={name} detail={detail} />}
          {tab === 'services'    && <ServicesTab namespace={namespace} name={name} />}
          {tab === 'tls'         && <TLSTab tls={detail.tls} tlsEnabled={detail.tlsEnabled} />}
          {tab === 'crds'        && <CrdsPanel namespace={namespace} instanceName={name} initialKind={initialCrdKind} />}
          {tab === 'events'      && <EventsTab namespace={namespace} name={name} />}
          {tab === 'resilience'  && <ResilienceTab namespace={namespace} name={name} detail={detail} onRefreshDetail={() => fetchDetail(true)} />}
        </>
      )}
    </div>
  )
}
