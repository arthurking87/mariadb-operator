import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, RefreshCw, Database, Server, HardDrive, Clock,
         Zap, AlertCircle, Loader2, Trash2, X, AlertTriangle, CheckCircle2,
         ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import { getSettings } from '../lib/settings'

const statusStyle = {
  Running:    { bg: 'rgba(63,185,80,0.1)',  color: '#3fb950', dot: '#3fb950' },
  'Not Ready':{ bg: 'rgba(248,81,73,0.1)',  color: '#f85149', dot: '#f85149' },
  Pending:    { bg: 'rgba(210,153,34,0.1)', color: '#d29922', dot: '#d29922' },
}
const typeIcon = { Replication: '⇌', Galera: '◉', Standalone: '○' }

function StatusBadge({ status }) {
  const s = statusStyle[status] || statusStyle['Not Ready']
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.color }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {status}
    </span>
  )
}

function BackupBadge({ scheduled }) {
  if (scheduled === null) return <span className="text-xs" style={{ color: '#8b949e' }}>—</span>
  return scheduled ? (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: '#3fb950' }}>
      <CheckCircle2 size={12} />Scheduled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: '#d29922' }}>
      <AlertTriangle size={12} />No schedule
    </span>
  )
}

// Raised surface tone (vs. the app-wide #161b22 card background) reserved for each page's
// single most important row of numbers — gives the eye one clear "start here" surface
// instead of every card (hero stat or minor nested list) reading as equally important.
const SURFACE_RAISED = '#1a2028'

function StatCard({ label, value, sub, icon: Icon, accent, loading }) {
  return (
    <div className="rounded-xl border p-5 relative overflow-hidden" style={{ background: SURFACE_RAISED, borderColor: '#21262d' }}>
      {/* Per-card color identity: a left accent stripe + faint corner tint, so the four
          stat cards are distinguishable at a glance instead of four identical gray boxes. */}
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(140% 100% at 0% 0%, ${accent}17, transparent 60%)` }} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: '#8b949e' }}>{label}</div>
          <div className="text-3xl font-bold" style={{ color: '#e6edf3' }}>
            {loading
              ? <span className="inline-block w-8 h-7 rounded animate-pulse" style={{ background: '#21262d' }} />
              : value}
          </div>
          {sub && <div className="text-xs mt-1" style={{ color: '#8b949e' }}>{sub}</div>}
        </div>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center border" style={{ background: accent + '1f', borderColor: accent + '40' }}>
          <Icon size={20} color={accent} strokeWidth={2.25} />
        </div>
      </div>
    </div>
  )
}

// ── filter dropdown ───────────────────────────────────────────────────────────

function FilterDropdown({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const active = value !== ''

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
        style={{
          background: active ? 'rgba(249,115,22,0.12)' : '#0d1117',
          borderColor: active ? '#f97316' : '#30363d',
          color: active ? '#f97316' : '#8b949e',
        }}
      >
        {label}{active && <span>: {value}</span>}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 rounded-xl border overflow-hidden z-20 min-w-36"
          style={{ background: '#161b22', borderColor: '#21262d', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {/* All option */}
          <button
            onClick={() => { onChange(''); setOpen(false) }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors"
            style={{ color: value === '' ? '#f97316' : '#8b949e', background: value === '' ? 'rgba(249,115,22,0.08)' : 'transparent' }}
            onMouseEnter={e => { if (value !== '') e.currentTarget.style.background = '#1c2330' }}
            onMouseLeave={e => { if (value !== '') e.currentTarget.style.background = 'transparent' }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: value === '' ? '#f97316' : 'transparent', border: '1px solid #30363d' }} />
            All
          </button>
          {options.map(opt => {
            const selected = value === opt.value
            const dot = statusStyle[opt.value]?.dot
            return (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors"
                style={{ color: selected ? '#f97316' : '#e6edf3', background: selected ? 'rgba(249,115,22,0.08)' : 'transparent' }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = '#1c2330' }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
              >
                {dot
                  ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
                  : <span className="w-4 text-center flex-shrink-0" style={{ fontSize: 11 }}>{opt.icon}</span>
                }
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── active filter chip ────────────────────────────────────────────────────────

function FilterChip({ label, value, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)' }}>
      {label}: {value}
      <button onClick={onRemove} className="flex items-center" style={{ color: '#f97316', opacity: 0.7 }}
        onMouseEnter={e => e.currentTarget.style.opacity = 1}
        onMouseLeave={e => e.currentTarget.style.opacity = 0.7}>
        <X size={11} />
      </button>
    </span>
  )
}

// ── delete modal ──────────────────────────────────────────────────────────────

function DeleteModal({ instance, onCancel, onConfirm, deleting, error }) {
  const [typed, setTyped] = useState('')
  const confirmed = typed === instance.name
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded-2xl border p-6 w-full max-w-md mx-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(248,81,73,0.15)' }}>
              <AlertTriangle size={20} color="#f85149" />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>Delete instance</h3>
              <p className="text-xs mt-0.5" style={{ color: '#8b949e' }}>This action cannot be undone</p>
            </div>
          </div>
          <button onClick={onCancel} style={{ color: '#8b949e' }}><X size={16} /></button>
        </div>
        <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.25)', color: '#8b949e' }}>
          The MariaDB CR <span style={{ color: '#e6edf3', fontWeight: 600 }}>{instance.name}</span> in namespace{' '}
          <span style={{ color: '#e6edf3', fontWeight: 600 }}>{instance.namespace}</span> and all its
          associated resources will be deleted. PVCs may be retained depending on your storage policy.
        </div>
        <div className="mb-5">
          <label className="text-xs mb-1.5 block" style={{ color: '#8b949e' }}>
            Type <span style={{ color: '#e6edf3', fontWeight: 600 }}>{instance.name}</span> to confirm
          </label>
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={instance.name} autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors"
            style={{ background: '#0d1117', borderColor: confirmed ? '#f85149' : '#30363d', color: '#e6edf3' }}
            onFocus={e => e.target.style.borderColor = confirmed ? '#f85149' : '#f97316'}
            onBlur={e => e.target.style.borderColor = confirmed ? '#f85149' : '#30363d'}
            onKeyDown={e => e.key === 'Enter' && confirmed && !deleting && onConfirm()} />
        </div>
        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg mb-4 text-xs" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
            <AlertCircle size={13} />{error}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={deleting} className="flex-1 py-2 rounded-lg text-sm border"
            style={{ background: 'transparent', borderColor: '#30363d', color: '#8b949e' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!confirmed || deleting}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: confirmed && !deleting ? 'rgba(248,81,73,0.9)' : '#21262d', color: confirmed && !deleting ? 'white' : '#8b949e', cursor: confirmed && !deleting ? 'pointer' : 'not-allowed' }}>
            {deleting ? <><Loader2 size={13} className="animate-spin" />Deleting…</> : <><Trash2 size={13} />Delete</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'Running',    label: 'Running',    icon: null },
  { value: 'Not Ready',  label: 'Not Ready',  icon: null },
  { value: 'Pending',    label: 'Pending',    icon: null },
]
const TYPE_OPTIONS = [
  { value: 'Replication', label: 'Replication', icon: '⇌' },
  { value: 'Galera',      label: 'Galera',      icon: '◉' },
  { value: 'Standalone',  label: 'Standalone',  icon: '○' },
]

export default function Dashboard({ setPage: navigate }) {
  const [instances, setInstances]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [search, setSearch]         = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // filters
  const [filterStatus,    setFilterStatus]    = useState('')
  const [filterType,      setFilterType]      = useState('')
  const [filterNamespace, setFilterNamespace] = useState(getSettings().defaultNamespace)

  // delete
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting]         = useState(false)
  const [deleteError, setDeleteError]   = useState(null)

  const fetchInstances = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true)
    try {
      const res = await fetch('/api/instances')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInstances(data.instances)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const { count, reset, total, paused, togglePause } = useAutoRefresh(fetchInstances, getSettings().refreshInterval)
  useEffect(() => { fetchInstances() }, [fetchInstances])

  const handleDelete = async () => {
    setDeleting(true); setDeleteError(null)
    try {
      const { namespace, name } = deleteTarget
      const res = await fetch(`/api/instances/${namespace}/${name}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDeleteTarget(null)
      fetchInstances()
    } catch (e) { setDeleteError(e.message) }
    finally { setDeleting(false) }
  }

  // derived
  const namespaces = [...new Set(instances.map(i => i.namespace))].sort()
  const nsOptions  = namespaces.map(n => ({ value: n, label: n, icon: null }))

  const activeFilters = [
    filterStatus    && { key: 'status',    label: 'Status',    value: filterStatus,    clear: () => setFilterStatus('') },
    filterType      && { key: 'type',      label: 'Type',      value: filterType,      clear: () => setFilterType('') },
    filterNamespace && { key: 'namespace', label: 'Namespace', value: filterNamespace, clear: () => setFilterNamespace('') },
  ].filter(Boolean)

  const clearAll = () => { setFilterStatus(''); setFilterType(''); setFilterNamespace(''); setSearch('') }

  const filtered = instances.filter(i => {
    if (search         && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.namespace.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus    && i.status    !== filterStatus)    return false
    if (filterType      && i.type      !== filterType)      return false
    if (filterNamespace && i.namespace !== filterNamespace) return false
    return true
  })

  const running      = instances.filter(i => i.status === 'Running').length
  const totalReplicas = instances.reduce((a, b) => a + (b.replicas || 0), 0)
  const hasFilter    = activeFilters.length > 0 || search !== ''

  return (
    <div className="px-8 py-8 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3.5">
          {/* Page-title icon: sized/weighted above the 12-15px icons used inline everywhere
              else, giving this page a visual anchor. Blue matches the instance name links in
              the table below, tying the two together as "this page is about instances". */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
            style={{ background: 'rgba(88,166,255,0.12)', borderColor: 'rgba(88,166,255,0.3)' }}>
            <Database size={20} color="#58a6ff" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>Instances</h1>
            <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>Manage your MariaDB clusters</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#30363d' }}>
            <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
            <button
              onClick={() => { fetchInstances(true); reset() }}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-sm transition-colors"
              style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
          <button
            onClick={() => navigate('create')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white', boxShadow: '0 0 20px rgba(249,115,22,0.25)' }}
          >
            <Plus size={15} strokeWidth={2.5} />
            New Instance
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Instances" value={instances.length} sub="across all namespaces" icon={Database} accent="#58a6ff" loading={loading} />
        <StatCard label="Running"         value={running}          sub={`${instances.length - running} degraded`} icon={Zap} accent="#3fb950" loading={loading} />
        <StatCard label="Total Replicas"  value={totalReplicas}    sub="pods managed" icon={Server} accent="#f97316" loading={loading} />
        <StatCard label="Namespaces"      value={namespaces.length} sub="with MariaDB" icon={HardDrive} accent="#bc8cff" loading={loading} />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
          <AlertCircle size={15} />{error}
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal size={13} style={{ color: '#8b949e', flexShrink: 0 }} />
          <FilterDropdown label="Status"    options={STATUS_OPTIONS} value={filterStatus}    onChange={setFilterStatus} />
          <FilterDropdown label="Type"      options={TYPE_OPTIONS}   value={filterType}      onChange={setFilterType} />
          <FilterDropdown label="Namespace" options={nsOptions}      value={filterNamespace} onChange={setFilterNamespace} />
          {hasFilter && (
            <button onClick={clearAll} className="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
              style={{ color: '#8b949e', border: '1px solid #30363d' }}
              onMouseEnter={e => e.currentTarget.style.color = '#e6edf3'}
              onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}>
              Clear all
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {activeFilters.map(f => (
              <FilterChip key={f.key} label={f.label} value={f.value} onRemove={f.clear} />
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: '#21262d' }}>
          <span className="text-sm font-medium" style={{ color: '#8b949e' }}>
            {loading ? '…' : (
              <>
                <span style={{ color: '#e6edf3' }}>{filtered.length}</span>
                {filtered.length !== instances.length && (
                  <span> of {instances.length}</span>
                )}
                {' '}instance{filtered.length !== 1 ? 's' : ''}
              </>
            )}
          </span>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#8b949e' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or namespace…"
              className="pl-8 pr-3 py-1.5 rounded-md text-sm border outline-none"
              style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3', width: 230 }}
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: '#8b949e' }}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16" style={{ color: '#8b949e' }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading instances…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Database size={24} className="mx-auto mb-3" style={{ color: '#30363d' }} />
            <p className="text-sm font-medium mb-1" style={{ color: '#8b949e' }}>
              {hasFilter ? 'No instances match the current filters' : 'No MariaDB instances found'}
            </p>
            {hasFilter ? (
              <button onClick={clearAll} className="mt-3 text-xs px-3 py-1.5 rounded-lg"
                style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}>
                Clear filters
              </button>
            ) : (
              <button onClick={() => navigate('create')} className="mt-3 text-sm px-4 py-2 rounded-lg font-medium"
                style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>
                Create your first instance
              </button>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                {['Name', 'Namespace', 'Type', 'Replicas', 'Primary', 'Version', 'Storage', 'Backup', 'Age', 'Status', ''].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider"
                    style={{ color: '#8b949e' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inst, i) => (
                <tr key={`${inst.namespace}/${inst.name}`}
                  className="group transition-colors cursor-pointer"
                  style={{ borderBottom: i < filtered.length - 1 ? '1px solid #21262d' : 'none' }}
                  onClick={() => navigate('detail', { namespace: inst.namespace, name: inst.name })}
                  onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{typeIcon[inst.type] ?? '○'}</span>
                      <span className="text-sm font-medium" style={{ color: '#58a6ff' }}>{inst.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={e => { e.stopPropagation(); setFilterNamespace(inst.namespace) }}
                      className="text-xs px-2 py-0.5 rounded transition-colors"
                      style={{ background: filterNamespace === inst.namespace ? 'rgba(249,115,22,0.12)' : '#1c2330', color: filterNamespace === inst.namespace ? '#f97316' : '#8b949e', border: `1px solid ${filterNamespace === inst.namespace ? 'rgba(249,115,22,0.3)' : '#30363d'}` }}
                    >
                      {inst.namespace}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={e => { e.stopPropagation(); setFilterType(inst.type) }}
                      className="text-sm transition-colors"
                      style={{ color: filterType === inst.type ? '#f97316' : '#e6edf3', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {inst.type}
                    </button>
                  </td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: '#e6edf3' }}>{inst.replicas}</td>
                  <td className="px-5 py-3.5 text-xs font-mono" style={{ color: '#8b949e' }}>{inst.primary}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: '#8b949e' }}>{inst.version}</td>
                  <td className="px-5 py-3.5 text-sm" style={{ color: '#8b949e' }}>{inst.storage}</td>
                  <td className="px-5 py-3.5">
                    <BackupBadge scheduled={inst.hasScheduledBackup} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 text-xs" style={{ color: '#8b949e' }}>
                      <Clock size={11} />{inst.age}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={e => { e.stopPropagation(); setFilterStatus(inst.status) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <StatusBadge status={inst.status} />
                    </button>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteTarget(inst); setDeleteError(null) }}
                      className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-7 h-7 rounded-md transition-all"
                      style={{ color: '#8b949e' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,81,73,0.15)'; e.currentTarget.style.color = '#f85149' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8b949e' }}
                      title="Delete instance"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <DeleteModal
          instance={deleteTarget}
          onCancel={() => { setDeleteTarget(null); setDeleteError(null) }}
          onConfirm={handleDelete}
          deleting={deleting}
          error={deleteError}
        />
      )}
    </div>
  )
}
