import { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, Check, Database, Server, Shield, HardDrive, Zap, ChevronDown, Eye, EyeOff, Info, Loader2, AlertCircle, CheckCircle2, Copy, X, Cpu } from 'lucide-react'

const STEPS = [
  { id: 'basic',    label: 'Basics',   icon: Database },
  { id: 'topology', label: 'Topology', icon: Server },
  { id: 'storage',  label: 'Storage',  icon: HardDrive },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'review',   label: 'Review',   icon: Check },
]

const TOPOLOGY_OPTIONS = [
  { id: 'standalone',  label: 'Standalone',     desc: 'Single instance. Simple, lowest cost.',                replicas: 1, icon: '○', tag: null },
  { id: 'replication', label: 'Replication',     desc: 'Primary + replicas with automatic failover.',          replicas: 3, icon: '⇌', tag: 'Recommended' },
  { id: 'galera',      label: 'Galera Cluster',  desc: 'Synchronous multi-primary write anywhere.',            replicas: 3, icon: '◉', tag: 'High Availability' },
]

const VERSION_OPTIONS       = ['11.8.5', '11.4.4', '10.11.10', '10.6.20']
const STORAGE_CLASS_OPTIONS = ['standard', 'csi-hostpath-sc', 'managed-premium']

const RESOURCE_PRESETS = [
  { id: 'micro',  label: 'Micro',  cpuReq: '250m',  cpuLim: '500m',  memReq: '256Mi', memLim: '512Mi' },
  { id: 'small',  label: 'Small',  cpuReq: '500m',  cpuLim: '1000m', memReq: '512Mi', memLim: '1Gi'   },
  { id: 'medium', label: 'Medium', cpuReq: '1000m', cpuLim: '2000m', memReq: '1Gi',   memLim: '2Gi',  tag: 'Recommended' },
  { id: 'large',  label: 'Large',  cpuReq: '2000m', cpuLim: '4000m', memReq: '2Gi',   memLim: '4Gi'   },
  { id: 'xlarge', label: 'X-Large',cpuReq: '4000m', cpuLim: '8000m', memReq: '4Gi',   memLim: '8Gi'   },
  { id: 'custom', label: 'Custom', cpuReq: '',       cpuLim: '',      memReq: '',      memLim: ''      },
]

// parse "500m" → 500, "2" → 2000, "2000m" → 2000
function cpuMilli(s) {
  if (!s) return 0
  return s.endsWith('m') ? parseInt(s) : parseFloat(s) * 1000
}
// parse "512Mi" → 512, "2Gi" → 2048
function memMi(s) {
  if (!s) return 0
  if (s.endsWith('Gi')) return parseFloat(s) * 1024
  if (s.endsWith('Mi')) return parseFloat(s)
  return 0
}
function fmtCPU(m)  { return m >= 1000 ? `${+(m/1000).toFixed(2)} cores` : `${m}m` }
function fmtMem(mi) {
  if (mi === 0) return '—'
  if (mi % 1024 === 0) return `${mi / 1024}Gi`
  return `${mi}Mi`
}

// ── tiny UI primitives ────────────────────────────────────────────────────────

function Label({ children, hint }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <label className="text-sm font-medium" style={{ color: '#e6edf3' }}>{children}</label>
      {hint && <Info size={12} style={{ color: '#8b949e' }} title={hint} />}
    </div>
  )
}

function Input({ label, hint, error, ...props }) {
  return (
    <div>
      {label && <Label hint={hint}>{label}</Label>}
      <input
        className="w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors"
        style={{ background: '#0d1117', borderColor: error ? '#f85149' : '#30363d', color: '#e6edf3' }}
        onFocus={e => e.target.style.borderColor = error ? '#f85149' : '#f97316'}
        onBlur={e => e.target.style.borderColor = error ? '#f85149' : '#30363d'}
        {...props}
      />
      {error && <p className="text-xs mt-1" style={{ color: '#f85149' }}>{error}</p>}
    </div>
  )
}

function Select({ label, hint, options, value, onChange }) {
  return (
    <div>
      {label && <Label hint={hint}>{label}</Label>}
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm border outline-none appearance-none pr-8 transition-colors"
          style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
          onFocus={e => e.target.style.borderColor = '#f97316'}
          onBlur={e => e.target.style.borderColor = '#30363d'}
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8b949e' }} />
      </div>
    </div>
  )
}

function PasswordInput({ label, hint, value, onChange, placeholder, error }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      {label && <Label hint={hint}>{label}</Label>}
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-10 rounded-lg text-sm border outline-none transition-colors"
          style={{ background: '#0d1117', borderColor: error ? '#f85149' : '#30363d', color: '#e6edf3' }}
          onFocus={e => e.target.style.borderColor = error ? '#f85149' : '#f97316'}
          onBlur={e => e.target.style.borderColor = error ? '#f85149' : '#30363d'}
        />
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: '#8b949e' }}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
      {error && <p className="text-xs mt-1" style={{ color: '#f85149' }}>{error}</p>}
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ background: checked ? '#f97316' : '#30363d', height: 22, width: 40, borderRadius: 11, position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
      <span style={{ position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'transform .2s', transform: checked ? 'translateX(18px)' : 'translateX(0)' }} />
    </button>
  )
}

// ── step components ───────────────────────────────────────────────────────────

function StepBasics({ form, update, errors }) {
  const [namespaces, setNamespaces] = useState([])
  const [nsLoading, setNsLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/namespaces')
      .then(r => r.json())
      .then(d => setNamespaces(d.namespaces ?? []))
      .catch(() => setNamespaces([]))
      .finally(() => setNsLoading(false))
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5" style={{ color: '#e6edf3' }}>Basic Configuration</h2>
        <p className="text-sm" style={{ color: '#8b949e' }}>Set the instance name and target namespace.</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Instance Name" hint="Unique name for the MariaDB CR" value={form.name} onChange={e => update('name', e.target.value)} placeholder="my-mariadb" error={errors.name} />
        <div>
          <Label hint="Kubernetes namespace">Namespace</Label>
          <div className="relative">
            {nsLoading ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm"
                style={{ background: '#0d1117', borderColor: '#30363d', color: '#8b949e' }}>
                <Loader2 size={13} className="animate-spin" />Loading…
              </div>
            ) : (
              <Select options={namespaces} value={form.namespace} onChange={v => update('namespace', v)} />
            )}
          </div>
        </div>
      </div>
      <Select label="MariaDB Version" options={VERSION_OPTIONS} value={form.version} onChange={v => update('version', v)} />
    </div>
  )
}

function StepTopology({ form, update }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5" style={{ color: '#e6edf3' }}>Topology</h2>
        <p className="text-sm" style={{ color: '#8b949e' }}>Choose the cluster mode and number of replicas.</p>
      </div>
      <div className="space-y-3">
        {TOPOLOGY_OPTIONS.map(opt => {
          const selected = form.topology === opt.id
          return (
            <button key={opt.id} type="button"
              onClick={() => { update('topology', opt.id); update('replicas', opt.replicas) }}
              className="w-full flex items-start gap-4 p-4 rounded-xl border text-left transition-all"
              style={{ background: selected ? 'rgba(249,115,22,0.08)' : '#0d1117', borderColor: selected ? '#f97316' : '#30363d' }}
            >
              <span className="text-2xl leading-none mt-0.5">{opt.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{opt.label}</span>
                  {opt.tag && <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>{opt.tag}</span>}
                </div>
                <span className="text-xs" style={{ color: '#8b949e' }}>{opt.desc}</span>
              </div>
              <div className="flex-shrink-0 w-4 h-4 rounded-full border-2 mt-0.5 flex items-center justify-center" style={{ borderColor: selected ? '#f97316' : '#30363d' }}>
                {selected && <div className="w-2 h-2 rounded-full" style={{ background: '#f97316' }} />}
              </div>
            </button>
          )
        })}
      </div>
      {form.topology !== 'standalone' && (
        <div>
          <Label hint="Number of MariaDB pods">Replicas</Label>
          <div className="flex items-center gap-3">
            {[1, 2, 3, 5, 7].map(n => (
              <button key={n} type="button" onClick={() => update('replicas', n)}
                className="w-11 h-11 rounded-lg text-sm font-semibold border transition-all"
                style={{ background: form.replicas === n ? 'rgba(249,115,22,0.15)' : '#0d1117', borderColor: form.replicas === n ? '#f97316' : '#30363d', color: form.replicas === n ? '#f97316' : '#8b949e' }}
              >{n}</button>
            ))}
          </div>
          {form.topology === 'replication' && (
            <div className="mt-4 flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.autoFailover} onChange={e => update('autoFailover', e.target.checked)} className="w-4 h-4 accent-orange-500" />
                <span className="text-sm" style={{ color: '#e6edf3' }}>Auto Failover</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.semiSync} onChange={e => update('semiSync', e.target.checked)} className="w-4 h-4 accent-orange-500" />
                <span className="text-sm" style={{ color: '#e6edf3' }}>Semi-sync Replication</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepStorage({ form, update }) {
  const sizes = ['1Gi', '5Gi', '10Gi', '20Gi', '50Gi', '100Gi']
  const isCustom = form.resourcePreset === 'custom'

  const selectPreset = (preset) => {
    update('resourcePreset', preset.id)
    if (preset.id !== 'custom') {
      update('cpuRequest', preset.cpuReq)
      update('cpuLimit',   preset.cpuLim)
      update('memRequest', preset.memReq)
      update('memLimit',   preset.memLim)
    }
  }

  // totals
  const totalCpuReq = fmtCPU(cpuMilli(form.cpuRequest) * form.replicas)
  const totalCpuLim = fmtCPU(cpuMilli(form.cpuLimit)   * form.replicas)
  const totalMemReq = fmtMem(memMi(form.memRequest)     * form.replicas)
  const totalMemLim = fmtMem(memMi(form.memLimit)       * form.replicas)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5" style={{ color: '#e6edf3' }}>Storage & Resources</h2>
        <p className="text-sm" style={{ color: '#8b949e' }}>Configure persistent volume and compute resources.</p>
      </div>

      {/* Storage size */}
      <div>
        <Label>Storage Size</Label>
        <div className="flex flex-wrap gap-2">
          {sizes.map(s => (
            <button key={s} type="button" onClick={() => update('storage', s)}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-all"
              style={{ background: form.storage === s ? 'rgba(249,115,22,0.15)' : '#0d1117', borderColor: form.storage === s ? '#f97316' : '#30363d', color: form.storage === s ? '#f97316' : '#8b949e' }}
            >{s}</button>
          ))}
        </div>
      </div>

      <Select label="Storage Class" hint="Kubernetes StorageClass for PVCs" options={STORAGE_CLASS_OPTIONS} value={form.storageClass} onChange={v => update('storageClass', v)} />

      {/* Service type */}
      <div>
        <Label>Service Type</Label>
        <div className="flex gap-2">
          {['ClusterIP', 'NodePort', 'LoadBalancer'].map(t => (
            <button key={t} type="button" onClick={() => update('serviceType', t)}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-all"
              style={{ background: form.serviceType === t ? 'rgba(249,115,22,0.15)' : '#0d1117', borderColor: form.serviceType === t ? '#f97316' : '#30363d', color: form.serviceType === t ? '#f97316' : '#8b949e' }}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: '1px solid #21262d' }} />

      {/* Resource presets */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={14} color="#bc8cff" />
          <span className="text-sm font-semibold" style={{ color: '#e6edf3' }}>CPU & Memory</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {RESOURCE_PRESETS.map(p => {
            const selected = form.resourcePreset === p.id
            return (
              <button key={p.id} type="button" onClick={() => selectPreset(p)}
                className="flex flex-col items-start p-3 rounded-xl border text-left transition-all"
                style={{ background: selected ? 'rgba(188,140,255,0.08)' : '#0d1117', borderColor: selected ? '#bc8cff' : '#30363d' }}>
                <div className="flex items-center gap-1.5 mb-1 w-full">
                  <span className="text-xs font-semibold" style={{ color: selected ? '#bc8cff' : '#e6edf3' }}>{p.label}</span>
                  {p.tag && <span className="text-xs px-1.5 py-0 rounded-full ml-auto" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316', fontSize: 10 }}>{p.tag}</span>}
                </div>
                {p.id !== 'custom' ? (
                  <div className="text-xs space-y-0.5" style={{ color: '#8b949e' }}>
                    <div>CPU {p.cpuReq} → {p.cpuLim}</div>
                    <div>Mem {p.memReq} → {p.memLim}</div>
                  </div>
                ) : (
                  <div className="text-xs" style={{ color: '#8b949e' }}>Define your own limits</div>
                )}
              </button>
            )
          })}
        </div>

        {/* Custom inputs */}
        {isCustom && (
          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl border mb-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
            <Input label="CPU Request" hint="e.g. 500m or 0.5" value={form.cpuRequest} onChange={e => update('cpuRequest', e.target.value)} placeholder="500m" />
            <Input label="CPU Limit"   hint="e.g. 1000m or 1"  value={form.cpuLimit}   onChange={e => update('cpuLimit',   e.target.value)} placeholder="1000m" />
            <Input label="Memory Request" hint="e.g. 512Mi or 1Gi" value={form.memRequest} onChange={e => update('memRequest', e.target.value)} placeholder="512Mi" />
            <Input label="Memory Limit"   hint="e.g. 1Gi or 2Gi"   value={form.memLimit}   onChange={e => update('memLimit',   e.target.value)} placeholder="1Gi" />
          </div>
        )}

        {/* Totals summary */}
        {(form.cpuRequest || form.memRequest) && (
          <div className="rounded-xl border p-4" style={{ background: '#0d1117', borderColor: '#21262d' }}>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>
                Cluster total — {form.cpuRequest} × {form.replicas} replica{form.replicas !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
              {[
                { label: 'CPU Requests',    val: totalCpuReq },
                { label: 'CPU Limits',      val: totalCpuLim },
                { label: 'Memory Requests', val: totalMemReq },
                { label: 'Memory Limits',   val: totalMemLim },
              ].map(({ label, val }) => (
                <div key={label} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: '#21262d' }}>
                  <span style={{ color: '#8b949e' }}>{label}</span>
                  <span className="font-semibold font-mono" style={{ color: '#e6edf3' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StepSecurity({ form, update, errors }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5" style={{ color: '#e6edf3' }}>Security</h2>
        <p className="text-sm" style={{ color: '#8b949e' }}>Configure passwords and TLS settings.</p>
      </div>
      <PasswordInput label="Root Password" hint="Password for the root MariaDB user" value={form.rootPassword} onChange={v => update('rootPassword', v)} placeholder="Enter root password" error={errors.rootPassword} />
      {form.topology !== 'standalone' && (
        <PasswordInput label="Replication Password" hint="Used by replicas to connect to primary" value={form.replPassword} onChange={v => update('replPassword', v)} placeholder="Enter replication password" error={errors.replPassword} />
      )}
      <div className="rounded-xl border p-4 space-y-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        {[
          { key: 'tls', label: 'Enable TLS', desc: 'Encrypt connections using auto-generated certificates' },
          { key: 'metrics', label: 'Metrics', desc: 'Export Prometheus metrics via mysqld-exporter' },
        ].map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>{label}</div>
              <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>{desc}</div>
            </div>
            <Toggle checked={form[key]} onChange={v => update(key, v)} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewRow({ label, value, accent }) {
  return (
    <div className="grid items-center gap-4 py-2.5 px-4 border-b" style={{ gridTemplateColumns: '160px 1fr', borderColor: '#21262d' }}>
      <span className="text-sm" style={{ color: '#8b949e' }}>{label}</span>
      <span className="text-sm font-medium truncate" style={{ color: accent || '#e6edf3' }}>{String(value)}</span>
    </div>
  )
}

function buildYAML(form) {
  const lines = [
    `apiVersion: k8s.mariadb.com/v1alpha1`,
    `kind: MariaDB`,
    `metadata:`,
    `  name: ${form.name || 'my-mariadb'}`,
    `  namespace: ${form.namespace}`,
    `spec:`,
    `  rootPasswordSecretKeyRef:`,
    `    name: ${form.name || 'my-mariadb'}`,
    `    key: root-password`,
    `  image: "docker-registry1.mariadb.com/library/mariadb:${form.version}"`,
    `  replicas: ${form.replicas}`,
    `  storage:`,
    `    size: ${form.storage}`,
    `    storageClassName: ${form.storageClass}`,
  ]
  if (form.topology === 'replication') {
    lines.push(`  replication:`, `    enabled: true`, `    primary:`, `      autoFailover: ${form.autoFailover}`, `    replica:`, `      replPasswordSecretKeyRef:`, `        name: ${form.name || 'my-mariadb'}`, `        key: password`, `    semiSyncEnabled: ${form.semiSync}`)
  } else if (form.topology === 'galera') {
    lines.push(`  galera:`, `    enabled: true`)
  }
  lines.push(`  service:`, `    type: ${form.serviceType}`)
  if (form.cpuRequest || form.memRequest) {
    lines.push(`  resources:`)
    lines.push(`    requests:`)
    if (form.cpuRequest) lines.push(`      cpu: "${form.cpuRequest}"`)
    if (form.memRequest) lines.push(`      memory: "${form.memRequest}"`)
    lines.push(`    limits:`)
    if (form.cpuLimit)   lines.push(`      cpu: "${form.cpuLimit}"`)
    if (form.memLimit)   lines.push(`      memory: "${form.memLimit}"`)
  }
  if (form.tls)     lines.push(`  tls:`, `    enabled: true`)
  if (form.metrics) lines.push(`  metrics:`, `    enabled: true`)
  return lines.join('\n')
}

function StepReview({ form }) {
  const yaml = buildYAML(form)
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(yaml); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5" style={{ color: '#e6edf3' }}>Review & Deploy</h2>
        <p className="text-sm" style={{ color: '#8b949e' }}>Confirm your configuration before deploying.</p>
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        <ReviewRow label="Name"      value={form.name || '—'}  accent="#58a6ff" />
        <ReviewRow label="Namespace" value={form.namespace} />
        <ReviewRow label="Version"   value={form.version} />
        <ReviewRow label="Topology"  value={TOPOLOGY_OPTIONS.find(t => t.id === form.topology)?.label} />
        <ReviewRow label="Replicas"  value={form.replicas} />
        <ReviewRow label="Storage"   value={`${form.storage} (${form.storageClass})`} />
        <ReviewRow label="Service"   value={form.serviceType} />
        {form.cpuRequest && <ReviewRow label="CPU (req → lim)"  value={`${form.cpuRequest} → ${form.cpuLimit}`} />}
        {form.memRequest && <ReviewRow label="Mem (req → lim)"  value={`${form.memRequest} → ${form.memLimit}`} />}
        {form.cpuRequest && <ReviewRow label="Total CPU (req)" value={fmtCPU(cpuMilli(form.cpuRequest) * form.replicas)} accent="#bc8cff" />}
        {form.memRequest && <ReviewRow label="Total Mem (req)" value={fmtMem(memMi(form.memRequest)   * form.replicas)} accent="#bc8cff" />}
        <ReviewRow label="TLS"     value={form.tls ? 'Enabled' : 'Disabled'}     accent={form.tls ? '#3fb950' : '#8b949e'} />
        <ReviewRow label="Metrics" value={form.metrics ? 'Enabled' : 'Disabled'} accent={form.metrics ? '#3fb950' : '#8b949e'} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>Generated YAML</span>
          <button onClick={copy} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors" style={{ borderColor: '#30363d', color: copied ? '#3fb950' : '#8b949e' }}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="rounded-xl p-4 text-xs overflow-x-auto" style={{ background: '#010409', color: '#c9d1d9', border: '1px solid #21262d', lineHeight: 1.6 }}>{yaml}</pre>
      </div>
    </div>
  )
}

// ── result modal ──────────────────────────────────────────────────────────────

function ResultModal({ result, onClose, onDashboard }) {
  const ok = result.ok
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-2xl border p-6 w-full max-w-md mx-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {ok
              ? <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(63,185,80,0.15)' }}><CheckCircle2 size={20} color="#3fb950" /></div>
              : <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(248,81,73,0.15)' }}><AlertCircle size={20} color="#f85149" /></div>
            }
            <div>
              <h3 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{ok ? 'Deployed successfully' : 'Deployment failed'}</h3>
              <p className="text-xs mt-0.5" style={{ color: '#8b949e' }}>{ok ? 'MariaDB is being provisioned' : 'Check the error below'}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color: '#8b949e' }}><X size={16} /></button>
        </div>

        {result.steps?.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {result.steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs" style={{ color: '#8b949e' }}>
                <Check size={12} color="#3fb950" />{s}
              </div>
            ))}
          </div>
        )}

        {!ok && result.error && (
          <pre className="text-xs p-3 rounded-lg mb-4 overflow-x-auto" style={{ background: '#010409', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
            {result.error}
          </pre>
        )}

        <div className="flex gap-2">
          {ok && (
            <button onClick={onDashboard}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white' }}>
              View Dashboard
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm border transition-colors"
            style={{ background: 'transparent', borderColor: '#30363d', color: '#8b949e' }}>
            {ok ? 'Stay here' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── validation ────────────────────────────────────────────────────────────────

function validate(step, form) {
  const errors = {}
  if (step === 0 && !form.name.trim()) errors.name = 'Instance name is required'
  if (step === 0 && !/^[a-z0-9-]+$/.test(form.name)) errors.name = 'Use lowercase letters, numbers and hyphens only'
  if (step === 3) {
    if (!form.rootPassword) errors.rootPassword = 'Root password is required'
    if (form.topology !== 'standalone' && !form.replPassword) errors.replPassword = 'Replication password is required'
  }
  return errors
}

// ── main component ────────────────────────────────────────────────────────────

const defaultForm = {
  name: '', namespace: 'default', version: '11.8.5',
  topology: 'replication', replicas: 3, autoFailover: true, semiSync: true,
  storage: '10Gi', storageClass: 'standard', serviceType: 'ClusterIP',
  resourcePreset: 'medium', cpuRequest: '1000m', cpuLimit: '2000m', memRequest: '1Gi', memLimit: '2Gi',
  rootPassword: '', replPassword: '', tls: true, metrics: false,
}

export default function CreateMariaDB({ setPage }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(defaultForm)
  const [errors, setErrors] = useState({})
  const [deploying, setDeploying] = useState(false)
  const [result, setResult] = useState(null)

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const goNext = () => {
    const errs = validate(step, form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setStep(s => s + 1)
  }

  const deploy = async () => {
    const errs = validate(step, form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setDeploying(true)
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      setResult(data)
    } catch (e) {
      setResult({ ok: false, error: e.message, steps: [] })
    } finally {
      setDeploying(false)
    }
  }

  const stepComponents = [
    <StepBasics    form={form} update={update} errors={errors} />,
    <StepTopology  form={form} update={update} />,
    <StepStorage   form={form} update={update} />,
    <StepSecurity  form={form} update={update} errors={errors} />,
    <StepReview    form={form} />,
  ]

  return (
    <div className="px-8 py-8 max-w-3xl mx-auto">
      {/* Back breadcrumb */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => setPage('dashboard')} className="flex items-center gap-1.5 text-sm transition-colors" style={{ color: '#8b949e' }}
          onMouseEnter={e => e.currentTarget.style.color = '#e6edf3'} onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}>
          <ArrowLeft size={15} />Back
        </button>
        <span style={{ color: '#30363d' }}>/</span>
        <span className="text-sm" style={{ color: '#e6edf3' }}>New MariaDB Instance</span>
      </div>

      {/* Step bar */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const done = i < step; const active = i === step; const Icon = s.icon
          return (
            <div key={s.id} className="flex items-center">
              <button type="button" onClick={() => i < step && setStep(i)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
                style={{ background: active ? 'rgba(249,115,22,0.12)' : 'transparent', cursor: i < step ? 'pointer' : 'default' }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: done ? '#f97316' : active ? 'rgba(249,115,22,0.2)' : '#21262d' }}>
                  {done ? <Check size={12} color="white" strokeWidth={3} /> : <Icon size={12} color={active ? '#f97316' : '#8b949e'} />}
                </div>
                <span className="text-xs font-medium" style={{ color: active ? '#f97316' : done ? '#e6edf3' : '#8b949e' }}>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className="w-6 h-px mx-1" style={{ background: i < step ? '#f97316' : '#21262d' }} />}
            </div>
          )
        })}
      </div>

      {/* Step card */}
      <div className="rounded-2xl border p-6 mb-6" style={{ background: '#161b22', borderColor: '#21262d' }}>
        {stepComponents[step]}
      </div>

      {/* Nav buttons */}
      <div className="flex items-center justify-between">
        <button onClick={() => step > 0 && setStep(s => s - 1)} disabled={step === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-all"
          style={{ background: 'transparent', borderColor: step > 0 ? '#30363d' : '#21262d', color: step > 0 ? '#8b949e' : '#30363d', cursor: step > 0 ? 'pointer' : 'not-allowed' }}>
          <ArrowLeft size={14} />Back
        </button>

        {step < STEPS.length - 1 ? (
          <button onClick={goNext}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white', boxShadow: '0 0 16px rgba(249,115,22,0.25)' }}>
            Continue<ArrowRight size={14} />
          </button>
        ) : (
          <button onClick={deploy} disabled={deploying}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: deploying ? '#30363d' : 'linear-gradient(135deg,#f97316,#ea580c)', color: deploying ? '#8b949e' : 'white', boxShadow: deploying ? 'none' : '0 0 16px rgba(249,115,22,0.25)', cursor: deploying ? 'not-allowed' : 'pointer' }}>
            {deploying ? <><Loader2 size={14} className="animate-spin" />Deploying…</> : <><Zap size={14} />Deploy Instance</>}
          </button>
        )}
      </div>

      {result && (
        <ResultModal result={result} onClose={() => setResult(null)} onDashboard={() => setPage('dashboard')} />
      )}
    </div>
  )
}
