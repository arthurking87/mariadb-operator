import { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, Check, Database, Server, Shield, HardDrive, Zap, ChevronDown, Eye, EyeOff, Info, Loader2, AlertCircle, CheckCircle2, Copy, X, Cpu, Archive, GitBranch, Network } from 'lucide-react'

const STEPS = [
  { id: 'basic',    label: 'Basics',   icon: Database },
  { id: 'topology', label: 'Topology', icon: Server },
  { id: 'storage',  label: 'Storage',  icon: HardDrive },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'backup',   label: 'Backup',   icon: Archive },
  { id: 'review',   label: 'Review',   icon: Check },
]

// Common cron schedules for the optional recurring Backup. "Custom" reveals a free-text
// cron field instead — see StepBackup below.
const BACKUP_PRESETS = [
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 3 * * *',   label: 'Daily at 03:00' },
  { value: '0 3 * * 0',   label: 'Weekly (Sunday 03:00)' },
  { value: 'custom',      label: 'Custom cron expression' },
]

// HA gets its own colour (green, "this is reliable") separate from Recommended (orange,
// "this is the suggested default") since Replication now carries both — they mean different
// things and showing HA only on Galera implied Replication with 3 replicas + failover wasn't
// also HA, which isn't true.
// Sync-mode tags use a third colour (blue) to stay visually distinct from Recommended
// (orange) and HA (green) — they're a different axis of information, not a ranking.
// Wording matters here: Replication defaults to semi-sync (an ack from ≥1 replica before
// commit); Galera is "virtually synchronous" (certification-based) — not the same guarantee
// as strict/full synchronous replication, so it's deliberately not labelled "Full Sync".
const TAG_RECOMMENDED   = { label: 'Recommended', color: '#f97316' }
const TAG_HA            = { label: 'High Availability', color: '#3fb950' }
const TAG_SEMI_SYNC     = { label: 'Semi Sync', color: '#58a6ff' }
const TAG_VIRTUALLY_SYNC = { label: 'Virtually Sync', color: '#58a6ff' }

const TOPOLOGY_OPTIONS = [
  { id: 'standalone',  label: 'Standalone',     desc: 'Single instance. Simple, lowest cost.',                replicas: 1, icon: Server,    tags: [] },
  { id: 'replication', label: 'Replication',     desc: 'Primary + replicas with automatic failover.',          replicas: 3, icon: GitBranch, tags: [TAG_RECOMMENDED, TAG_HA, TAG_SEMI_SYNC] },
  { id: 'galera',      label: 'Galera Cluster',  desc: 'Virtually synchronous multi-primary write anywhere.',  replicas: 3, icon: Network,   tags: [TAG_HA, TAG_VIRTUALLY_SYNC] },
]

const VERSION_OPTIONS = ['11.8.5', '11.4.4', '10.11.10', '10.6.20']

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

function StepTopology({ form, update, errors }) {
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
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: selected ? 'rgba(249,115,22,0.15)' : '#161b22' }}>
                <opt.icon size={18} color={selected ? '#f97316' : '#8b949e'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{opt.label}</span>
                  {opt.tags.map(t => (
                    <span key={t.label} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: t.color + '26', color: t.color }}>{t.label}</span>
                  ))}
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
          <Label hint="mariadb-operator requires 2+ replicas whenever replication or Galera is enabled — 1 replica gets rejected by its admission webhook.">Replicas</Label>
          <div className="flex items-center gap-3">
            {[2, 3, 5, 7].map(n => (
              <button key={n} type="button" onClick={() => update('replicas', n)}
                className="w-11 h-11 rounded-lg text-sm font-semibold border transition-all"
                style={{ background: form.replicas === n ? 'rgba(249,115,22,0.15)' : '#0d1117', borderColor: form.replicas === n ? '#f97316' : '#30363d', color: form.replicas === n ? '#f97316' : '#8b949e' }}
              >{n}</button>
            ))}
          </div>
          {errors.replicas && <p className="text-xs mt-1" style={{ color: '#f85149' }}>{errors.replicas}</p>}
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
  const [storageClasses, setStorageClasses] = useState(null) // null = still loading

  useEffect(() => {
    fetch('/api/storageclasses')
      .then(r => r.json())
      .then(d => setStorageClasses(d.storageClasses ?? []))
      .catch(() => setStorageClasses([]))
  }, [])

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

      <Input
        label="Storage Class"
        hint={storageClasses === null ? 'Loading StorageClasses from the cluster…' : 'Pick a suggestion below or type any StorageClass name — e.g. netapp-san-ssd-dc1'}
        list="storage-class-options"
        value={form.storageClass}
        onChange={e => update('storageClass', e.target.value)}
        placeholder="standard"
      />
      <datalist id="storage-class-options">
        {(storageClasses ?? []).map(sc => (
          <option key={sc.name} value={sc.name}>{sc.isDefault ? `${sc.name} (default)` : sc.name}</option>
        ))}
      </datalist>
      {form.replicas > 1 && (
        <div className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(88,166,255,0.08)', color: '#79c0ff' }}>
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            This one StorageClass is used for all {form.replicas} replicas — mariadb-operator doesn't support a different StorageClass per replica.
            To spread replicas across DC-specific classes like <code>netapp-san-ssd-dc1/dc2/dc3</code>, the usual pattern is a single topology-aware
            StorageClass (<code>volumeBindingMode: WaitForFirstConsumer</code> + <code>allowedTopologies</code>) combined with pod topology spread —
            that's cluster/CSI-driver configuration outside this form.
          </span>
        </div>
      )}

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
          <Cpu size={16} color="#bc8cff" />
          <span className="text-base font-semibold" style={{ color: '#e6edf3' }}>CPU & Memory</span>
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
      <div className="grid grid-cols-2 gap-4">
        <PasswordInput label="Root Password" hint="Password for the root MariaDB user" value={form.rootPassword} onChange={v => update('rootPassword', v)} placeholder="Enter root password" error={errors.rootPassword} />
        <PasswordInput label="Confirm Root Password" value={form.rootPasswordConfirm} onChange={v => update('rootPasswordConfirm', v)} placeholder="Re-enter root password" error={errors.rootPasswordConfirm} />
      </div>
      {form.topology !== 'standalone' && (
        <div className="grid grid-cols-2 gap-4">
          <PasswordInput label="Replication Password" hint="Used by replicas to connect to primary" value={form.replPassword} onChange={v => update('replPassword', v)} placeholder="Enter replication password" error={errors.replPassword} />
          <PasswordInput label="Confirm Replication Password" value={form.replPasswordConfirm} onChange={v => update('replPasswordConfirm', v)} placeholder="Re-enter replication password" error={errors.replPasswordConfirm} />
        </div>
      )}

      <div className="rounded-xl border p-4 space-y-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        <div>
          <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>Initial database &amp; user</div>
          <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>Optional — the operator creates this database and a non-root user with ALL PRIVILEGES on it at first boot. Leave the database name blank to skip; you can always add databases/users afterwards from the instance's CRDs tab.</div>
        </div>
        <Input label="Database name" value={form.initialDatabase} onChange={e => update('initialDatabase', e.target.value)} placeholder="e.g. myapp" error={errors.initialDatabase} />
        {form.initialDatabase.trim() && (
          <>
            <Input label="Username" value={form.initialUsername} onChange={e => update('initialUsername', e.target.value)} placeholder="e.g. myapp" error={errors.initialUsername} />
            <div className="grid grid-cols-2 gap-4">
              <PasswordInput label="Password" value={form.initialPassword} onChange={v => update('initialPassword', v)} error={errors.initialPassword} />
              <PasswordInput label="Confirm Password" value={form.initialPasswordConfirm} onChange={v => update('initialPasswordConfirm', v)} error={errors.initialPasswordConfirm} />
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border p-4 space-y-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>Enable TLS</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>Encrypt connections using auto-generated certificates</div>
          </div>
          <Toggle checked={form.tls} onChange={v => update('tls', v)} />
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>Metrics</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>Export Prometheus metrics via mysqld-exporter</div>
          </div>
          <Toggle checked={form.metrics} onChange={v => {
            update('metrics', v)
            update('metricsUsername', v ? 'metrics' : '')
            update('metricsPassword', v ? 'metrics' : '')
            update('metricsPasswordConfirm', v ? 'metrics' : '')
          }} />
        </div>
        {form.metrics && (
          <div className="text-xs" style={{ color: '#8b949e' }}>Monitoring user credentials are fixed to <code>metrics</code> / <code>metrics</code> — this account only gets the operator's built-in metrics grants (read-only, no schema access), so a shared low-value credential isn't a meaningful risk here.</div>
        )}
      </div>

      <div className="rounded-xl border p-4 space-y-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>Percona PMM Monitoring</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>Adds a pmm-client sidecar that registers this instance with an existing PMM Server for query analytics and dashboards. Requires a PMM Server already running somewhere reachable from this cluster — this only wires up the agent, it doesn't deploy PMM Server itself.</div>
          </div>
          <Toggle checked={form.pmmEnabled} onChange={v => update('pmmEnabled', v)} />
        </div>
        {form.pmmEnabled && (
          <>
            <Input
              label="PMM Server address" hint="Host:port of your PMM Server, e.g. pmm-server.monitoring.svc.cluster.local:443"
              value={form.pmmServerAddress} onChange={e => update('pmmServerAddress', e.target.value)}
              placeholder="pmm-server.monitoring.svc.cluster.local:443" error={errors.pmmServerAddress}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input label="PMM Server username" value={form.pmmServerUsername} onChange={e => update('pmmServerUsername', e.target.value)} placeholder="admin" error={errors.pmmServerUsername} />
              <PasswordInput label="PMM Server password" value={form.pmmServerPassword} onChange={v => update('pmmServerPassword', v)} error={errors.pmmServerPassword} />
            </div>
            <PasswordInput label="Confirm PMM Server password" value={form.pmmServerPasswordConfirm} onChange={v => update('pmmServerPasswordConfirm', v)} error={errors.pmmServerPasswordConfirm} />
            <div className="flex items-center justify-between">
              <div className="text-xs" style={{ color: '#8b949e' }}>Skip TLS certificate verification (common with self-signed PMM Server certs)</div>
              <Toggle checked={form.pmmInsecureTls} onChange={v => update('pmmInsecureTls', v)} />
            </div>
            <Input
              label="PMM Client image" hint="percona/pmm-client:3 for a PMM 3 Server, percona/pmm-client:2 for PMM 2 — must match your PMM Server's major version"
              value={form.pmmImage} onChange={e => update('pmmImage', e.target.value)} placeholder="percona/pmm-client:3"
            />
            <div className="text-xs" style={{ color: '#8b949e' }}>
              Database monitoring user — pmm-agent connects to this instance locally (127.0.0.1:3306) with these credentials via
              <code> pmm-admin add mysql</code>. This user needs <code>SELECT, PROCESS, REPLICATION CLIENT, RELOAD</code> grants
              (see Percona's PMM docs for the exact list for your MariaDB version). Create it via the instance's Users/Grants CRD
              tab after deploying if it doesn't exist yet — this form only wires the connection, it doesn't create the database user.
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Database username" value={form.pmmDbUsername} onChange={e => update('pmmDbUsername', e.target.value)} placeholder="pmm" error={errors.pmmDbUsername} />
              <PasswordInput label="Database password" value={form.pmmDbPassword} onChange={v => update('pmmDbPassword', v)} error={errors.pmmDbPassword} />
            </div>
            <PasswordInput label="Confirm database password" value={form.pmmDbPasswordConfirm} onChange={v => update('pmmDbPasswordConfirm', v)} error={errors.pmmDbPasswordConfirm} />
          </>
        )}
      </div>
    </div>
  )
}

function StepBackup({ form, update, errors }) {
  const cron = form.backupPreset === 'custom' ? form.backupCronCustom : form.backupPreset
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-0.5" style={{ color: '#e6edf3' }}>Backup</h2>
        <p className="text-sm" style={{ color: '#8b949e' }}>Optionally set up a recurring backup for this instance, right from the start.</p>
      </div>

      <div className="rounded-xl border p-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>Enable scheduled backups</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>Creates a <code>Backup</code> resource with a cron schedule (like a CronJob) alongside the instance.</div>
          </div>
          <Toggle checked={form.backupEnabled} onChange={v => update('backupEnabled', v)} />
        </div>
      </div>

      {form.backupEnabled && (
        <>
          <div>
            <Label hint="How often the backup runs. Same cron syntax as a Kubernetes CronJob.">Schedule</Label>
            <div className="relative">
              <select
                value={form.backupPreset}
                onChange={e => update('backupPreset', e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border outline-none appearance-none pr-8 transition-colors"
                style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
              >
                {BACKUP_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8b949e' }} />
            </div>
          </div>

          {form.backupPreset === 'custom' && (
            <Input
              label="Cron expression" hint="Standard 5-field cron syntax, e.g. 0 3 * * * for daily at 03:00"
              value={form.backupCronCustom} onChange={e => update('backupCronCustom', e.target.value)}
              placeholder="0 3 * * *" error={errors.backupCronCustom}
            />
          )}

          <Select
            label="Storage destination" options={['PersistentVolumeClaim', 'S3']} value={form.backupStorageType} onChange={v => update('backupStorageType', v)}
          />

          {form.backupStorageType === 'S3' ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Input label="S3 Endpoint" hint="Host and port, no scheme — works with MinIO or any S3-compatible endpoint" value={form.backupS3Endpoint} onChange={e => update('backupS3Endpoint', e.target.value)} placeholder="minio.example.com:9000" error={errors.backupS3Endpoint} />
                <Input label="Bucket" value={form.backupS3Bucket} onChange={e => update('backupS3Bucket', e.target.value)} placeholder="mariadb-backups" error={errors.backupS3Bucket} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Region (optional)" value={form.backupS3Region} onChange={e => update('backupS3Region', e.target.value)} />
                <Input label="Prefix (optional)" value={form.backupS3Prefix} onChange={e => update('backupS3Prefix', e.target.value)} placeholder="mariadb/backups" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <PasswordInput label="Access Key ID" value={form.backupS3AccessKeyId} onChange={v => update('backupS3AccessKeyId', v)} error={errors.backupS3AccessKeyId} />
                <PasswordInput label="Secret Access Key" value={form.backupS3SecretAccessKey} onChange={v => update('backupS3SecretAccessKey', v)} error={errors.backupS3SecretAccessKey} />
              </div>
              <div className="flex items-center justify-between rounded-xl border p-4" style={{ background: '#0d1117', borderColor: '#30363d' }}>
                <div className="text-sm font-medium" style={{ color: '#e6edf3' }}>Use TLS</div>
                <Toggle checked={form.backupS3Tls} onChange={v => update('backupS3Tls', v)} />
              </div>
            </>
          ) : (
            <Input label="Backup storage size" value={form.backupStorageSize} onChange={e => update('backupStorageSize', e.target.value)} placeholder="1Gi" />
          )}

          <Select label="Compression" options={['none', 'bzip2', 'gzip']} value={form.backupCompression} onChange={v => update('backupCompression', v)} />

          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(88,166,255,0.08)', color: '#79c0ff' }}>
            <Info size={13} className="flex-shrink-0" />
            Effective schedule: <code>{cron || '—'}</code>
          </div>

          <p className="text-xs" style={{ color: '#8b949e' }}>
            Need VolumeSnapshot-based backups instead? Those use the <code>PhysicalBackup</code> CRD — set that up afterwards from the instance's <strong>CRDs</strong> tab, it supports S3, VolumeSnapshot and PVC destinations.
          </p>
        </>
      )}
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
  if (form.initialDatabase.trim()) {
    lines.push(
      `  username: ${form.initialUsername}`,
      `  database: ${form.initialDatabase}`,
      `  passwordSecretKeyRef:`,
      `    name: ${form.name || 'my-mariadb'}`,
      `    key: initial-password`,
    )
  }
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
  if (form.tls) lines.push(`  tls:`, `    enabled: true`)
  if (form.metrics) {
    lines.push(`  metrics:`, `    enabled: true`)
    if (form.metricsUsername.trim()) {
      lines.push(
        `    username: ${form.metricsUsername}`,
        `    passwordSecretKeyRef:`,
        `      name: ${form.name || 'my-mariadb'}`,
        `      key: metrics-password`,
      )
    }
  }
  if (form.pmmEnabled) {
    const nm = form.name || 'my-mariadb'
    lines.push(
      // sidecarContainers has no securityContext field, so pmm-client always inherits
      // the pod-level securityContext. The operator's default there (mysql's uid, 999)
      // doesn't match the uid pmm-client:3's own files are owned by (pmm-agent, 1002),
      // so the agent fails to write its tmp dir once it reaches a live PMM Server.
      // Push the pod-level uid/gid to pmm-agent's and pin mariadb back to 999 via its
      // own container-level securityContext (which overrides the pod-level default).
      `  podSecurityContext:`,
      `    runAsNonRoot: true`,
      `    runAsUser: 1002`,
      `    runAsGroup: 1002`,
      `    fsGroup: 1002`,
      `  securityContext:`,
      `    runAsUser: 999`,
      `    runAsGroup: 999`,
      `  volumes:`,
      `    - name: pmm-client-storage`,
      `      emptyDir: {}`,
      `  sidecarContainers:`,
      `    - name: pmm-client`,
      `      image: ${form.pmmImage}`,
      `      volumeMounts:`,
      `        - name: pmm-client-storage`,
      `          mountPath: /usr/local/percona/pmm/config`,
      `      env:`,
      `        - name: PMM_AGENT_SERVER_ADDRESS`,
      `          value: "${form.pmmServerAddress}"`,
      `        - name: PMM_AGENT_SERVER_USERNAME`,
      `          valueFrom:`,
      `            secretKeyRef:`,
      `              name: ${nm}-pmm-server`,
      `              key: username`,
      `        - name: PMM_AGENT_SERVER_PASSWORD`,
      `          valueFrom:`,
      `            secretKeyRef:`,
      `              name: ${nm}-pmm-server`,
      `              key: password`,
      `        - name: PMM_AGENT_SERVER_INSECURE_TLS`,
      `          value: "${form.pmmInsecureTls}"`,
      `        - name: PMM_AGENT_CONFIG_FILE`,
      `          value: "config/pmm-agent.yaml"`,
      `        - name: PMM_AGENT_SETUP`,
      `          value: "1"`,
      `        - name: PMM_AGENT_SETUP_FORCE`,
      `          value: "1"`,
      `        - name: PMM_AGENT_SIDECAR`,
      `          value: "1"`,
      `        - name: PMM_DB_USERNAME`,
      `          value: "${form.pmmDbUsername}"`,
      `        - name: PMM_DB_PASSWORD`,
      `          valueFrom:`,
      `            secretKeyRef:`,
      `              name: ${nm}-pmm-db`,
      `              key: password`,
      `        - name: PMM_AGENT_PRERUN_SCRIPT`,
      `          value: "pmm-admin status --wait=10s; pmm-admin add mysql --username=\${PMM_DB_USERNAME} --password=\${PMM_DB_PASSWORD} --host=127.0.0.1 --port=3306 --service-name=${nm} --query-source=perfschema"`,
    )
  }
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
        <ReviewRow
          label="Initial database"
          value={form.initialDatabase.trim() ? `${form.initialDatabase} (user: ${form.initialUsername})` : 'None'}
          accent={form.initialDatabase.trim() ? '#3fb950' : '#8b949e'}
        />
        <ReviewRow label="TLS"     value={form.tls ? 'Enabled' : 'Disabled'}     accent={form.tls ? '#3fb950' : '#8b949e'} />
        <ReviewRow
          label="Metrics"
          value={form.metrics ? (form.metricsUsername.trim() ? `Enabled (user: ${form.metricsUsername})` : 'Enabled (auto-managed user)') : 'Disabled'}
          accent={form.metrics ? '#3fb950' : '#8b949e'}
        />
        <ReviewRow
          label="Percona PMM"
          value={form.pmmEnabled ? `Enabled (server: ${form.pmmServerAddress || '—'})` : 'Disabled'}
          accent={form.pmmEnabled ? '#3fb950' : '#8b949e'}
        />
        <ReviewRow
          label="Scheduled backup"
          value={form.backupEnabled
            ? `${form.backupPreset === 'custom' ? form.backupCronCustom : form.backupPreset} → ${form.backupStorageType === 'S3' ? `S3 (${form.backupS3Bucket})` : form.backupStorageSize}`
            : 'Disabled'}
          accent={form.backupEnabled ? '#3fb950' : '#8b949e'}
        />
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
  if (step === 1 && form.topology !== 'standalone' && form.replicas <= 1) {
    errors.replicas = "mariadb-operator requires 2+ replicas when replication or Galera is enabled"
  }
  if (step === 3) {
    if (!form.rootPassword) errors.rootPassword = 'Root password is required'
    else if (form.rootPassword !== form.rootPasswordConfirm) errors.rootPasswordConfirm = 'Passwords do not match'
    if (form.topology !== 'standalone') {
      if (!form.replPassword) errors.replPassword = 'Replication password is required'
      else if (form.replPassword !== form.replPasswordConfirm) errors.replPasswordConfirm = 'Passwords do not match'
    }
    if (form.initialDatabase.trim()) {
      if (!form.initialUsername.trim()) errors.initialUsername = 'Username is required when creating an initial database'
      if (!form.initialPassword) errors.initialPassword = 'Password is required'
      else if (form.initialPassword !== form.initialPasswordConfirm) errors.initialPasswordConfirm = 'Passwords do not match'
    }
    if (form.metrics && form.metricsUsername.trim()) {
      if (!form.metricsPassword) errors.metricsPassword = 'Password is required when a monitoring username is set'
      else if (form.metricsPassword !== form.metricsPasswordConfirm) errors.metricsPasswordConfirm = 'Passwords do not match'
    }
    if (form.pmmEnabled) {
      if (!form.pmmServerAddress.trim()) errors.pmmServerAddress = 'PMM Server address is required'
      if (!form.pmmServerUsername.trim()) errors.pmmServerUsername = 'PMM Server username is required'
      if (!form.pmmServerPassword) errors.pmmServerPassword = 'PMM Server password is required'
      else if (form.pmmServerPassword !== form.pmmServerPasswordConfirm) errors.pmmServerPasswordConfirm = 'Passwords do not match'
      if (!form.pmmDbUsername.trim()) errors.pmmDbUsername = 'Database monitoring username is required'
      if (!form.pmmDbPassword) errors.pmmDbPassword = 'Database monitoring password is required'
      else if (form.pmmDbPassword !== form.pmmDbPasswordConfirm) errors.pmmDbPasswordConfirm = 'Passwords do not match'
    }
  }
  if (step === 4 && form.backupEnabled) {
    if (form.backupPreset === 'custom' && !/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(form.backupCronCustom.trim()))
      errors.backupCronCustom = 'Enter a valid 5-field cron expression (minute hour day month weekday)'
    if (form.backupStorageType === 'S3') {
      if (!form.backupS3Endpoint.trim()) errors.backupS3Endpoint = 'S3 endpoint is required'
      if (!form.backupS3Bucket.trim()) errors.backupS3Bucket = 'Bucket is required'
      if (!form.backupS3AccessKeyId) errors.backupS3AccessKeyId = 'Access key ID is required'
      if (!form.backupS3SecretAccessKey) errors.backupS3SecretAccessKey = 'Secret access key is required'
    }
  }
  return errors
}

// ── main component ────────────────────────────────────────────────────────────

const defaultForm = {
  name: '', namespace: 'default', version: '11.8.5',
  topology: 'replication', replicas: 3, autoFailover: true, semiSync: true,
  storage: '10Gi', storageClass: 'standard', serviceType: 'ClusterIP',
  resourcePreset: 'medium', cpuRequest: '1000m', cpuLimit: '2000m', memRequest: '1Gi', memLimit: '2Gi',
  rootPassword: '', rootPasswordConfirm: '', replPassword: '', replPasswordConfirm: '', tls: true, metrics: false,
  initialDatabase: '', initialUsername: '', initialPassword: '', initialPasswordConfirm: '',
  metricsUsername: '', metricsPassword: '', metricsPasswordConfirm: '',
  pmmEnabled: false, pmmServerAddress: '', pmmServerUsername: 'admin',
  pmmServerPassword: '', pmmServerPasswordConfirm: '', pmmInsecureTls: true,
  pmmImage: 'percona/pmm-client:3',
  pmmDbUsername: '', pmmDbPassword: '', pmmDbPasswordConfirm: '',
  backupEnabled: false, backupPreset: '0 3 * * *', backupCronCustom: '', backupCompression: 'none',
  backupStorageType: 'PersistentVolumeClaim', backupStorageSize: '1Gi',
  backupS3Endpoint: '', backupS3Bucket: '', backupS3Region: '', backupS3Prefix: '',
  backupS3AccessKeyId: '', backupS3SecretAccessKey: '', backupS3Tls: false,
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
    <StepTopology  form={form} update={update} errors={errors} />,
    <StepStorage   form={form} update={update} />,
    <StepSecurity  form={form} update={update} errors={errors} />,
    <StepBackup    form={form} update={update} errors={errors} />,
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
            {deploying ? <><Loader2 size={13} className="animate-spin" />Deploying…</> : <><Zap size={13} />Deploy Instance</>}
          </button>
        )}
      </div>

      {result && (
        <ResultModal result={result} onClose={() => setResult(null)} onDashboard={() => setPage('dashboard')} />
      )}
    </div>
  )
}
