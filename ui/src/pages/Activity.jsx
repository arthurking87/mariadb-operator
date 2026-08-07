import { useState, useEffect, useCallback } from 'react'
import { Activity as ActivityIcon, RefreshCw, AlertCircle, ListTree, CheckCircle2, XCircle } from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import { getSettings } from '../lib/settings'

function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-1.5 rounded-lg text-xs font-medium border"
      style={{
        background: value ? 'rgba(249,115,22,0.12)' : '#0d1117',
        borderColor: value ? '#f97316' : '#30363d',
        color: value ? '#f97316' : '#8b949e',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function ClusterEventsTab() {
  const [events, setEvents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]       = useState(null)
  const [filterNs, setFilterNs]     = useState('')
  const [filterType, setFilterType] = useState('')

  const fetchEvents = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await fetch('/api/events')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEvents(data.events)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const { count, reset, total, paused, togglePause } = useAutoRefresh(fetchEvents, getSettings().refreshInterval)

  const namespaces = [...new Set(events.map(e => e.namespace))].sort()

  const filtered = events.filter(e => {
    if (filterNs   && e.namespace !== filterNs)   return false
    if (filterType && e.type      !== filterType) return false
    return true
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: '#8b949e' }}>Kubernetes Events for objects the operator has touched across every instance.</p>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0" style={{ borderColor: '#30363d' }}>
          <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
          <button
            onClick={() => { fetchEvents(true); reset() }}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Select value={filterNs} onChange={setFilterNs} options={namespaces} placeholder="All namespaces" />
        <Select value={filterType} onChange={setFilterType} options={['Normal', 'Warning']} placeholder="All types" />
        <span className="text-xs ml-auto" style={{ color: '#8b949e' }}>{filtered.length} event{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
          <AlertCircle size={15} />{error}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#f97316' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ActivityIcon size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
            <p className="text-sm" style={{ color: '#8b949e' }}>No recent events.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                {['Type', 'Reason', 'Namespace', 'Object', 'Message', 'Count', 'Last Seen'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev, i) => (
                <tr key={i} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #21262d' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium" style={{ color: ev.type === 'Warning' ? '#d29922' : '#3fb950' }}>
                      {ev.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium" style={{ color: '#e6edf3' }}>{ev.reason}</td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{ev.namespace}</td>
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
        )}
      </div>
    </div>
  )
}

// Local record of mutating requests sent through THIS UI (deploys, deletes, switchovers,
// chaos drills, CRD create/delete, ...) — distinct from the Cluster Events tab, which shows
// Kubernetes' own Events for whatever the *operator* touched. No login system here, so this
// can't say who did something, only what and when — added after a real incident where an
// instance disappeared and it took a while to confirm someone had just clicked "Delete
// instance", because that call left no trace of its own. Resets if the API server restarts
// without its on-disk log file (see server.js ACTION_LOG_PATH) present.
function UiActionsTab() {
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchActions = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const res = await fetch('/api/activity/log')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setActions(data.actions)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchActions() }, [fetchActions])
  const { count, reset, total, paused, togglePause } = useAutoRefresh(fetchActions, getSettings().refreshInterval)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: '#8b949e' }}>
          Mutating requests sent through this UI itself — deploys, deletes, switchovers, chaos drills, CRD changes. No
          identity tracking (this UI has no login), just what happened and when.
        </p>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0" style={{ borderColor: '#30363d' }}>
          <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
          <button
            onClick={() => { fetchActions(true); reset() }}
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

      <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#f97316' }} />
          </div>
        ) : actions.length === 0 ? (
          <div className="text-center py-16">
            <ListTree size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
            <p className="text-sm" style={{ color: '#8b949e' }}>No actions recorded yet — this fills up as you use the UI.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                {['Result', 'Action', 'Method', 'Time'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actions.map((a, i) => (
                <tr key={i} style={{ borderBottom: i < actions.length - 1 ? '1px solid #21262d' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td className="px-4 py-3">
                    {a.ok
                      ? <CheckCircle2 size={14} color="#3fb950" />
                      : <span title={`HTTP ${a.status}`}><XCircle size={14} color="#f85149" /></span>}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: '#e6edf3' }}>{a.summary}</td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{a.method}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: '#8b949e' }}>
                    {new Date(a.time).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function Activity() {
  const [tab, setTab] = useState('events')

  return (
    <div className="px-8 py-8 max-w-[1800px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3.5">
          {/* Page-title badge, same treatment as Dashboard/Backups/Capacity/Switchover —
              purple keeps this page's identity distinct from every other page's badge color. */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
            style={{ background: 'rgba(188,140,255,0.12)', borderColor: 'rgba(188,140,255,0.3)' }}>
            <ActivityIcon size={20} color="#bc8cff" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>Activity</h1>
            <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>What happened, from two different vantage points.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-6">
        {[
          { id: 'events', label: 'Cluster Events', icon: ActivityIcon },
          { id: 'actions', label: 'UI Actions', icon: ListTree },
        ].map(t => {
          const on = tab === t.id
          const Icon = t.icon
          return (
            <button
              key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
              style={{
                background: on ? 'rgba(249,115,22,0.12)' : 'transparent',
                borderColor: on ? '#f97316' : '#30363d',
                color: on ? '#f97316' : '#8b949e',
              }}
            >
              <Icon size={13} />{t.label}
            </button>
          )
        })}
      </div>

      {tab === 'events' ? <ClusterEventsTab /> : <UiActionsTab />}
    </div>
  )
}
