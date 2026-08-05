import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft, RefreshCw, Database, Server, HardDrive, Clock,
  Shield, Activity, AlertCircle, Loader2, CheckCircle2,
  XCircle, Zap, Network, Box, Copy, Check, Pencil, X, Cpu, ChevronDown,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import ResourceTab from '../components/crd/ResourceTab'
import { CRD_SCHEMAS, INSTANCE_CRD_TABS } from '../lib/crdSchemas'

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
      <Icon size={15} color={accent} />
      <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{title}</h2>
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

function CrdsPanel({ namespace, instanceName }) {
  const [kind, setKind] = useState(INSTANCE_CRD_TABS[0])
  const schema = CRD_SCHEMAS[kind]

  return (
    <div>
      <div className="flex items-center flex-wrap gap-1.5 mb-5">
        {INSTANCE_CRD_TABS.map(k => {
          const s = CRD_SCHEMAS[k]
          const Icon = Icons[s.icon] || Icons.Box
          const on = kind === k
          return (
            <button
              key={k} onClick={() => setKind(k)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: on ? 'rgba(249,115,22,0.12)' : 'transparent',
                borderColor: on ? '#f97316' : '#30363d',
                color: on ? '#f97316' : '#8b949e',
              }}
            >
              <Icon size={13} />{s.pluralLabel}
            </button>
          )
        })}
      </div>
      <ResourceTab schema={schema} namespace={namespace} instanceName={instanceName} />
    </div>
  )
}

// ── tab panels ────────────────────────────────────────────────────────────────

function OverviewTab({ detail, namespace, name, onRefresh }) {
  const conditionColor = s => s === 'True' ? '#3fb950' : '#f85149'

  return (
    <div className="space-y-6">
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

function PodsTab({ namespace, name, primary }) {
  const [pods, setPods] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
            {['Pod', 'Role', 'Phase', 'Ready', 'Restarts', 'Pod IP', 'Node', 'Age'].map(h => (
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReplicationTab({ detail }) {
  const replicas = detail.replication?.replicas ?? {}
  const roles    = detail.replication?.roles ?? {}

  if (!detail.replication) {
    return <p className="text-sm" style={{ color: '#8b949e' }}>No replication data available.</p>
  }

  const pods = Object.entries(roles)

  return (
    <div className="space-y-4">
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
            {['Service', 'Role', 'Type', 'Cluster IP', 'Ports'].map(h => (
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
        <Shield size={28} className="mx-auto mb-2" style={{ color: '#30363d' }} />
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

// ── main page ─────────────────────────────────────────────────────────────────

export default function InstanceDetail({ instanceKey, setPage }) {
  const { namespace, name } = instanceKey
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [tab, setTab]       = useState('overview')
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
    <div className="px-8 py-8 max-w-5xl mx-auto">
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
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-lg font-semibold" style={{ color: '#e6edf3' }}>{name}</h1>
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
          {tab === 'replication' && <ReplicationTab detail={detail} />}
          {tab === 'services'    && <ServicesTab namespace={namespace} name={name} />}
          {tab === 'tls'         && <TLSTab tls={detail.tls} tlsEnabled={detail.tlsEnabled} />}
          {tab === 'crds'        && <CrdsPanel namespace={namespace} instanceName={name} />}
          {tab === 'events'      && <EventsTab namespace={namespace} name={name} />}
        </>
      )}
    </div>
  )
}
