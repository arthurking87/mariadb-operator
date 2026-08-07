import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowRightLeft, RefreshCw, AlertCircle, Loader2, CheckCircle2, Crown, XCircle } from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import { getSettings } from '../lib/settings'

const statusMeta = {
  idle:      { label: 'Idle',      color: '#8b949e' },
  switching: { label: 'Switching…',color: '#d29922' },
  done:      { label: 'Switched',  color: '#3fb950' },
  error:     { label: 'Failed',    color: '#f85149' },
}

function podIndexOf(podName) {
  const m = podName.match(/-(\d+)$/)
  return m ? Number(m[1]) : null
}

function StatusPill({ status }) {
  const s = statusMeta[status] ?? statusMeta.idle
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      {status === 'switching' && <Loader2 size={11} className="animate-spin" color={s.color} />}
      {status === 'done' && <CheckCircle2 size={11} color={s.color} />}
      {status === 'error' && <XCircle size={11} color={s.color} />}
      <span style={{ color: s.color }}>{s.label}</span>
    </span>
  )
}

export default function Switchover({ setPage }) {
  const [rows, setRows] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const pollRefs = useRef({})

  const loadRows = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const instRes = await fetch('/api/instances')
      const instData = await instRes.json()
      if (instData.error) throw new Error(instData.error)
      const eligible = (instData.instances ?? []).filter(i => i.type !== 'Standalone')

      const withPods = await Promise.all(eligible.map(async inst => {
        const podsRes = await fetch(`/api/instances/${inst.namespace}/${inst.name}/pods`)
        const podsData = await podsRes.json()
        const pods = (podsData.pods ?? []).map(p => p.name).sort()
        const nonPrimary = pods.filter(p => p !== inst.primary)
        return {
          key: `${inst.namespace}/${inst.name}`,
          namespace: inst.namespace,
          name: inst.name,
          type: inst.type,
          primary: inst.primary,
          pods,
          target: nonPrimary[0] ?? null,
          selected: false,
          status: 'idle',
          error: null,
        }
      }))
      setRows(prev => withPods.map(fresh => {
        const existing = prev?.find(r => r.key === fresh.key)
        if (!existing) return fresh
        // Auto-refresh must not clobber a switchover in flight (pollRow is still ticking
        // against this row) or the user's pending checkbox/target selections.
        if (existing.status === 'switching') {
          return { ...fresh, primary: existing.primary, pods: existing.pods, selected: existing.selected,
            target: existing.target, status: existing.status, error: existing.error }
        }
        return { ...fresh, selected: existing.selected,
          target: existing.pods.includes(existing.target) ? existing.target : fresh.target }
      }))
      setError(null)
    } catch (e) {
      setError(e.message)
      setRows(prev => prev ?? [])
    } finally {
      if (isManual) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadRows()
    return () => { Object.values(pollRefs.current).forEach(clearInterval) }
  }, [loadRows])

  const { count, reset, total, paused, togglePause } = useAutoRefresh(loadRows, getSettings().refreshInterval)

  const updateRow = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))

  const pollRow = (row) => {
    let ticks = 0
    pollRefs.current[row.key] = setInterval(async () => {
      ticks += 1
      try {
        const res = await fetch(`/api/instances/${row.namespace}/${row.name}`)
        const d = await res.json()
        const switched = d.conditions?.find(c => c.type === 'PrimarySwitched')
        const done = switched?.status === 'True' && d.primary === row.target
        if (done) {
          clearInterval(pollRefs.current[row.key])
          updateRow(row.key, { status: 'done', primary: d.primary })
        } else if (ticks > 30) { // ~90s at 3s/tick
          clearInterval(pollRefs.current[row.key])
          updateRow(row.key, { status: 'error', error: 'Timed out waiting for PrimarySwitched — check the instance\'s Events tab.' })
        }
      } catch { /* transient — keep polling */ }
    }, 3000)
  }

  const switchOne = async (row) => {
    if (!row.target || row.status === 'switching') return
    const targetIndex = podIndexOf(row.target)
    if (targetIndex === null) {
      updateRow(row.key, { status: 'error', error: `Could not parse pod index from "${row.target}"` })
      return
    }
    updateRow(row.key, { status: 'switching', error: null })
    try {
      const res = await fetch(`/api/instances/${row.namespace}/${row.name}/switchover`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ podIndex: targetIndex }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      pollRow(row)
    } catch (e) {
      updateRow(row.key, { status: 'error', error: e.message })
    }
  }

  const runSelected = async () => {
    setRunning(true)
    const selected = rows.filter(r => r.selected && r.status !== 'switching')
    for (const row of selected) {
      await switchOne(row)
    }
    setRunning(false)
  }

  const selectedCount = rows?.filter(r => r.selected).length ?? 0

  return (
    <div className="px-8 py-8 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="min-w-0 flex-1 pr-6 flex items-start gap-3.5">
          {/* Page-title badge, same treatment as Dashboard/Backups/Capacity — amber echoes
              this page's own "switching" status color (see statusMeta above) rather than
              colliding with Dashboard's blue or Backups' orange. */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
            style={{ background: 'rgba(210,153,34,0.12)', borderColor: 'rgba(210,153,34,0.3)' }}>
            <ArrowRightLeft size={20} color="#d29922" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>Switchover</h1>
            <p className="text-sm mt-0.5 break-words" style={{ color: '#8b949e' }}>
              Planned primary handover — uses the operator's own <code>spec.replication.primary.podIndex</code> /{' '}
              <code>spec.galera.primary.podIndex</code> mechanism, not a chaos pod-delete. Pick a target replica per instance,
              select the ones you want, and run them together.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0" style={{ borderColor: '#30363d' }}>
          <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
          <button
            onClick={() => { loadRows(true); reset() }}
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

      {rows === null ? (
        <div className="text-center py-16">
          <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#f97316' }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center" style={{ background: '#161b22', borderColor: '#21262d' }}>
          <ArrowRightLeft size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
          <p className="text-sm" style={{ color: '#8b949e' }}>No Replication or Galera instances found — Standalone instances have no primary to switch.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <label className="flex items-center gap-2 text-sm" style={{ color: '#8b949e' }}>
              <input type="checkbox"
                checked={selectedCount === rows.length}
                onChange={e => setRows(rs => rs.map(r => ({ ...r, selected: e.target.checked })))} />
              Select all
            </label>
            <button
              onClick={runSelected}
              disabled={selectedCount === 0 || running}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                background: selectedCount > 0 && !running ? 'linear-gradient(135deg,#f97316,#ea580c)' : '#21262d',
                color: selectedCount > 0 && !running ? 'white' : '#8b949e',
                cursor: selectedCount > 0 && !running ? 'pointer' : 'not-allowed',
              }}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}
              Run {selectedCount || ''} switchover{selectedCount === 1 ? '' : 's'}
            </button>
          </div>

          <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid #21262d' }}>
                  {['', 'Instance', 'Topology', 'Current Primary', 'Switch To', 'Status', ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.key} style={{ borderBottom: i < rows.length - 1 ? '1px solid #21262d' : 'none' }}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={r.selected} disabled={r.status === 'switching'}
                        onChange={e => updateRow(r.key, { selected: e.target.checked })} />
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setPage && setPage('detail', { namespace: r.namespace, name: r.name })}
                        className="text-sm font-medium" style={{ color: '#58a6ff', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                        {r.name}
                      </button>
                      <div className="text-xs font-mono" style={{ color: '#8b949e' }}>{r.namespace}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}>{r.type}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs font-mono" style={{ color: '#e6edf3' }}>
                        <Crown size={11} color="#f97316" />{r.primary}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select value={r.target ?? ''} disabled={r.status === 'switching'}
                        onChange={e => updateRow(r.key, { target: e.target.value })}
                        className="px-2 py-1.5 rounded-lg text-xs font-mono border"
                        style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}>
                        {r.pods.filter(p => p !== r.primary).map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={r.status} />
                      {r.error && <div className="text-xs mt-1 max-w-[200px]" style={{ color: '#f85149' }}>{r.error}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => switchOne(r)} disabled={!r.target || r.status === 'switching'}
                        className="text-xs px-3 py-1.5 rounded-lg font-medium"
                        style={{
                          background: r.target && r.status !== 'switching' ? 'rgba(88,166,255,0.12)' : '#21262d',
                          color: r.target && r.status !== 'switching' ? '#58a6ff' : '#8b949e',
                          border: '1px solid ' + (r.target && r.status !== 'switching' ? 'rgba(88,166,255,0.35)' : '#30363d'),
                          cursor: r.target && r.status !== 'switching' ? 'pointer' : 'not-allowed',
                        }}>
                        Switch
                      </button>
                    </td>
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
