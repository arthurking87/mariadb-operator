import { useState, useEffect, useCallback } from 'react'
import { Gauge, RefreshCw, AlertCircle, Cpu, MemoryStick, HardDrive, Database } from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import { getSettings } from '../lib/settings'

function formatBytes(n) {
  if (!n) return '0'
  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n % 1 === 0 ? n : n.toFixed(1)}${units[i]}`
}

// Raised-surface + left accent-stripe treatment, matching the hero stat row on Dashboard
// and Backups (see Dashboard.jsx's SURFACE_RAISED / Backups.jsx's StatCard) — this is
// Capacity's own "hero numbers" row, so it gets the same elevated surface rather than the
// flat #161b22 tone used everywhere else on the page.
function StatCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="rounded-xl border p-5 relative overflow-hidden" style={{ background: '#1a2028', borderColor: '#21262d' }}>
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(140% 100% at 0% 0%, ${accent}17, transparent 60%)` }} />
      <div className="relative flex items-center gap-2 mb-3" style={{ color: '#8b949e' }}>
        <Icon size={13} color={accent} />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="relative text-2xl font-semibold font-mono" style={{ color: '#e6edf3' }}>{value}</div>
      {sub && <div className="relative text-xs mt-1" style={{ color: '#8b949e' }}>{sub}</div>}
    </div>
  )
}

function Bar({ label, value, max, color, formatted }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0
  return (
    <div className="mb-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: '#e6edf3' }}>{label}</span>
        <span className="text-xs font-mono" style={{ color: '#8b949e' }}>{formatted}</span>
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: '#21262d' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function Capacity({ setPage }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchCapacity = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await fetch('/api/capacity')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchCapacity() }, [fetchCapacity])
  const { count, reset, total, paused, togglePause } = useAutoRefresh(fetchCapacity, getSettings().refreshInterval)

  return (
    <div className="px-8 py-8 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3.5">
          {/* Page-title badge, same treatment as Dashboard/Backups — green distinguishes this
              page's identity from Dashboard's blue and Backups' orange. */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
            style={{ background: 'rgba(63,185,80,0.12)', borderColor: 'rgba(63,185,80,0.3)' }}>
            <Gauge size={20} color="#3fb950" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>Capacity</h1>
            <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>Requested CPU / memory / storage committed across all MariaDB instances</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#30363d' }}>
          <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
          <button
            onClick={() => { fetchCapacity(true); reset() }}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
          <AlertCircle size={15} />{error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16">
          <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#f97316' }} />
        </div>
      ) : !data ? null : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <StatCard label="Instances" value={data.totals.instances} sub={`${data.totals.replicas} pods total`} icon={Database} accent="#f97316" />
            <StatCard label="CPU Requested" value={`${data.totals.cpuRequest.toFixed(2)}`} sub={`${data.totals.cpuLimit.toFixed(2)} cores at limit`} icon={Cpu} accent="#58a6ff" />
            <StatCard label="Memory Requested" value={formatBytes(data.totals.memRequest)} sub={`${formatBytes(data.totals.memLimit)} at limit`} icon={MemoryStick} accent="#a371f7" />
            <StatCard label="Storage Requested" value={formatBytes(data.totals.storage)} sub="sum of PVC sizes × replicas" icon={HardDrive} accent="#3fb950" />
          </div>

          {/* No node-level comparison note */}
          <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-xs" style={{ background: 'rgba(139,148,158,0.08)', color: '#8b949e', border: '1px solid #21262d' }}>
            <Gauge size={13} />
            This cluster has no metrics-server installed, so this is what's <em>requested</em> across instances, not live node utilization —
            useful for "how much have I committed" capacity planning, not real-time load.
          </div>

          {/* Per-namespace breakdown */}
          {data.namespaces.length > 0 && (
            <div className="rounded-xl border p-5 mb-6" style={{ background: '#161b22', borderColor: '#21262d' }}>
              <h2 className="text-base font-semibold mb-4" style={{ color: '#e6edf3' }}>By namespace</h2>
              {data.namespaces.map(ns => (
                <div key={ns.namespace} className="mb-5 last:mb-0 pb-5 last:pb-0 border-b last:border-0" style={{ borderColor: '#21262d' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#1c2330', color: '#e6edf3', border: '1px solid #30363d' }}>{ns.namespace}</span>
                    <span className="text-xs" style={{ color: '#8b949e' }}>{ns.instances} instance{ns.instances === 1 ? '' : 's'} · {ns.replicas} pods</span>
                  </div>
                  <Bar label="CPU request" value={ns.cpuRequest} max={data.totals.cpuRequest} color="#58a6ff" formatted={`${ns.cpuRequest.toFixed(2)} cores`} />
                  <Bar label="Memory request" value={ns.memRequest} max={data.totals.memRequest} color="#a371f7" formatted={formatBytes(ns.memRequest)} />
                  <Bar label="Storage" value={ns.storage} max={data.totals.storage} color="#3fb950" formatted={formatBytes(ns.storage)} />
                </div>
              ))}
            </div>
          )}

          {/* Per-instance table */}
          <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #21262d' }}>
                  {['Instance', 'Namespace', 'Replicas', 'CPU Req/Lim', 'Mem Req/Lim', 'Storage'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.instances.map((inst, i) => (
                  <tr key={`${inst.namespace}/${inst.name}`} style={{ borderBottom: i < data.instances.length - 1 ? '1px solid #21262d' : 'none', cursor: setPage ? 'pointer' : 'default' }}
                    onClick={() => setPage && setPage('detail', { namespace: inst.namespace, name: inst.name })}
                    onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: '#58a6ff' }}>{inst.name}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{inst.namespace}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{inst.replicas}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: '#e6edf3' }}>{inst.cpuRequest ?? '—'} / {inst.cpuLimit ?? '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: '#e6edf3' }}>{inst.memRequest ?? '—'} / {inst.memLimit ?? '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono" style={{ color: '#e6edf3' }}>{inst.storage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
