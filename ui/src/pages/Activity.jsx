import { useState, useEffect, useCallback } from 'react'
import { Activity as ActivityIcon, RefreshCw, AlertCircle } from 'lucide-react'
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

export default function Activity() {
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
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e6edf3' }}>Activity</h1>
          <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>Recent events across all MariaDB instances</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ borderColor: '#30363d' }}>
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

      {/* Filters */}
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
