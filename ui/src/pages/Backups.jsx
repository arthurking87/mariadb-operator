import { useState, useEffect, useCallback, useMemo } from 'react'
import { Archive, RotateCcw, Clock3, AlertCircle, AlertTriangle, Trash2, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import CountdownRing from '../components/CountdownRing'
import { getSettings } from '../lib/settings'
import CreateResourceModal from '../components/crd/CreateResourceModal'
import { CRD_SCHEMAS, storageDestination, statusFromConditions, relTime } from '../lib/crdSchemas'

// PointInTimeRecoveryStatus has no `conditions` field (just lastRecoverableTime), so this
// only ever matches Backup/PhysicalBackup/Restore rows — PITR rows fall through to '—'.
function isFailed(item) {
  const c = item.status?.conditions?.find(c => c.type === 'Complete' || c.type === 'Ready')
  return !!c && c.status === 'False'
}

function StatCard({ label, value, tone, icon: Icon }) {
  const color = tone === 'danger' ? '#f85149' : tone === 'warn' ? '#d29922' : tone === 'ok' ? '#3fb950' : '#e6edf3'
  return (
    <div className="rounded-xl border p-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: '#8b949e' }}>
        <Icon size={13} />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold font-mono" style={{ color }}>{value}</div>
    </div>
  )
}

function SectionHeader({ icon: Icon, title, count, accent, children }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon size={15} color={accent} />
        <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{title}</h2>
        <span className="text-xs" style={{ color: '#8b949e' }}>({count})</span>
      </div>
      {children}
    </div>
  )
}

function StatusCell({ item }) {
  const label = statusFromConditions(null, item)
  const cond = item.status?.conditions?.find(c => c.type === 'Complete' || c.type === 'Ready')
  const failed = isFailed(item)
  const succeeded = cond?.status === 'True'
  const color = failed ? '#f85149' : succeeded ? '#3fb950' : '#8b949e'
  const Icon = failed ? XCircle : succeeded ? CheckCircle2 : Clock3
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color }}>
      <Icon size={12} />{label}
    </span>
  )
}

function EmptyRow({ colSpan, text }) {
  return (
    <tr><td colSpan={colSpan} className="px-4 py-8 text-center text-xs" style={{ color: '#8b949e' }}>{text}</td></tr>
  )
}

export default function Backups({ setPage }) {
  const [instances, setInstances] = useState(null)
  const [backups, setBackups] = useState(null)
  const [physicalBackups, setPhysicalBackups] = useState(null)
  const [restores, setRestores] = useState(null)
  const [pitrs, setPitrs] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const [newBackupInstance, setNewBackupInstance] = useState('')
  const [showNewBackup, setShowNewBackup] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true)
    try {
      const [instRes, bRes, pbRes, rRes, pitrRes] = await Promise.all([
        fetch('/api/instances'),
        fetch('/api/crd/backup'),
        fetch('/api/crd/physicalbackup'),
        fetch('/api/crd/restore'),
        fetch('/api/crd/pointintimerecovery'),
      ])
      const [instData, bData, pbData, rData, pitrData] = await Promise.all([
        instRes.json(), bRes.json(), pbRes.json(), rRes.json(), pitrRes.json(),
      ])
      for (const d of [instData, bData, pbData, rData, pitrData]) {
        if (d.error) throw new Error(d.error)
      }
      setInstances(instData.instances ?? [])
      setBackups(bData.items ?? [])
      setPhysicalBackups(pbData.items ?? [])
      setRestores(rData.items ?? [])
      setPitrs(pitrData.items ?? [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      if (isManual) setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  const { count, reset, total, paused, togglePause } = useAutoRefresh(load, getSettings().refreshInterval)

  const backupRows = useMemo(() => {
    if (!backups || !physicalBackups) return null
    return [
      ...backups.map(b => ({ ...b, kind: 'backup', kindLabel: 'Backup' })),
      ...physicalBackups.map(b => ({ ...b, kind: 'physicalbackup', kindLabel: 'Physical' })),
    ].sort((a, b) => new Date(b.creationTimestamp) - new Date(a.creationTimestamp))
  }, [backups, physicalBackups])

  // Cross-reference each PITR's physicalBackupRef back to the PhysicalBackup that owns it,
  // purely to show which instance a PITR belongs to — PointInTimeRecoverySpec itself has no
  // mariaDbRef, only a physicalBackupRef.
  const pitrRows = useMemo(() => {
    if (!pitrs || !physicalBackups) return null
    return pitrs.map(p => {
      const pb = physicalBackups.find(b => b.namespace === p.namespace && b.name === p.spec?.physicalBackupRef?.name)
      return { ...p, instanceName: pb?.spec?.mariaDbRef?.name ?? '—' }
    })
  }, [pitrs, physicalBackups])

  const noScheduleInstances = useMemo(() => {
    if (!instances || !backupRows) return []
    return instances.filter(inst => !backupRows.some(b =>
      b.namespace === inst.namespace && b.spec?.mariaDbRef?.name === inst.name && b.spec?.schedule?.cron))
  }, [instances, backupRows])

  const attentionCount = useMemo(() => {
    if (!backupRows || !restores) return 0
    return backupRows.filter(isFailed).length + restores.filter(isFailed).length
  }, [backupRows, restores])

  const loading = instances === null || backupRows === null || restores === null || pitrRows === null

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/crd/${deleteTarget.kind}/${deleteTarget.namespace}/${deleteTarget.name}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDeleteTarget(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const goToInstance = (namespace, name) => setPage && setPage('detail', { namespace, name })

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="min-w-0 flex-1 pr-6">
          <h1 className="text-xl font-semibold" style={{ color: '#e6edf3' }}>Backups</h1>
          <p className="text-sm mt-0.5 break-words" style={{ color: '#8b949e' }}>
            Backup schedule health and restore history across every instance in the cluster — Backup / PhysicalBackup /
            Restore / PointInTimeRecovery in one place, instead of one instance's CRDs tab at a time.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border flex-shrink-0" style={{ borderColor: '#30363d' }}>
          <CountdownRing count={count} total={total} paused={paused} onTogglePause={togglePause} />
          <button
            onClick={() => { load(true); reset() }}
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
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-3 mb-8">
            <StatCard label="Backups" value={backupRows.length} icon={Archive} />
            <StatCard label="No schedule" value={noScheduleInstances.length} tone={noScheduleInstances.length > 0 ? 'warn' : 'ok'} icon={AlertTriangle} />
            <StatCard label="Needs attention" value={attentionCount} tone={attentionCount > 0 ? 'danger' : 'ok'} icon={XCircle} />
            <StatCard label="Restore jobs" value={restores.length} icon={RotateCcw} />
          </div>

          {noScheduleInstances.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg mb-8 text-sm" style={{ background: 'rgba(210,153,34,0.1)', color: '#d29922', border: '1px solid rgba(210,153,34,0.3)' }}>
              <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-medium">{noScheduleInstances.length} instance{noScheduleInstances.length === 1 ? '' : 's'} with no recurring backup schedule:</span>{' '}
                {noScheduleInstances.map((inst, i) => (
                  <span key={`${inst.namespace}/${inst.name}`}>
                    {i > 0 && ', '}
                    <button onClick={() => goToInstance(inst.namespace, inst.name)}
                      className="underline" style={{ color: '#d29922', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      {inst.namespace}/{inst.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Backups */}
          <div className="mb-10">
            <SectionHeader icon={Archive} title="Backups" count={backupRows.length} accent="#f97316">
              <div className="flex items-center gap-2">
                <select value={newBackupInstance} onChange={e => setNewBackupInstance(e.target.value)}
                  className="px-2 py-1.5 rounded-lg text-xs border" style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}>
                  <option value="">Select an instance…</option>
                  {instances.map(i => (
                    <option key={`${i.namespace}/${i.name}`} value={`${i.namespace}/${i.name}`}>{i.namespace}/{i.name}</option>
                  ))}
                </select>
                <button onClick={() => setShowNewBackup(true)} disabled={!newBackupInstance}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{
                    background: newBackupInstance ? 'linear-gradient(135deg,#f97316,#ea580c)' : '#21262d',
                    color: newBackupInstance ? 'white' : '#8b949e',
                    cursor: newBackupInstance ? 'pointer' : 'not-allowed',
                  }}>
                  New Backup
                </button>
              </div>
            </SectionHeader>
            <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262d' }}>
                    {['Instance', 'Name', 'Kind', 'Destination', 'Schedule', 'Status', 'Created', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {backupRows.length === 0 ? <EmptyRow colSpan={8} text="No Backup or PhysicalBackup resources found." /> : backupRows.map((b, i) => (
                    <tr key={`${b.kind}/${b.namespace}/${b.name}`} style={{ borderBottom: i < backupRows.length - 1 ? '1px solid #21262d' : 'none' }}>
                      <td className="px-4 py-3 text-xs">
                        <button onClick={() => goToInstance(b.namespace, b.spec?.mariaDbRef?.name)}
                          style={{ color: '#58a6ff', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          {b.namespace}/{b.spec?.mariaDbRef?.name ?? '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: '#e6edf3' }}>{b.name}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}>{b.kindLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{storageDestination(null, b)}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{b.spec?.schedule?.cron || 'One-off'}</td>
                      <td className="px-4 py-3"><StatusCell item={b} /></td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{relTime(b.creationTimestamp)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {b.kind === 'backup' && (
                          <button onClick={() => setRestoreTarget(b)} title="Restore"
                            className="text-xs px-2 py-1 rounded-md font-medium mr-1"
                            style={{ background: 'rgba(88,166,255,0.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,0.35)', cursor: 'pointer' }}>
                            Restore
                          </button>
                        )}
                        <button onClick={() => setDeleteTarget({ kind: b.kind, namespace: b.namespace, name: b.name, label: `${b.kindLabel} "${b.name}"` })}
                          title="Delete" style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Restores */}
          <div className="mb-10">
            <SectionHeader icon={RotateCcw} title="Restores" count={restores.length} accent="#d29922" />
            <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262d' }}>
                    {['Instance', 'Name', 'From backup', 'Status', 'Created', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {restores.length === 0 ? <EmptyRow colSpan={6} text="No Restore jobs have been run yet." /> : restores.map((r, i) => (
                    <tr key={`${r.namespace}/${r.name}`} style={{ borderBottom: i < restores.length - 1 ? '1px solid #21262d' : 'none' }}>
                      <td className="px-4 py-3 text-xs">
                        <button onClick={() => goToInstance(r.namespace, r.spec?.mariaDbRef?.name)}
                          style={{ color: '#58a6ff', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          {r.namespace}/{r.spec?.mariaDbRef?.name ?? '—'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: '#e6edf3' }}>{r.name}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{r.spec?.backupRef?.name ?? '—'}</td>
                      <td className="px-4 py-3"><StatusCell item={r} /></td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{relTime(r.creationTimestamp)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setDeleteTarget({ kind: 'restore', namespace: r.namespace, name: r.name, label: `Restore "${r.name}"` })}
                          title="Delete" style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* PITR */}
          <div>
            <SectionHeader icon={Clock3} title="Point-in-Time Recovery" count={pitrRows.length} accent="#79c0ff" />
            <p className="text-xs mb-3" style={{ color: '#8b949e' }}>
              Binlog archival configs, one per PhysicalBackup — read-only here. Creating one needs a PhysicalBackup with S3
              or Azure Blob storage already set up on that instance; use its CRDs tab for now.
            </p>
            <div className="rounded-xl border overflow-hidden" style={{ background: '#161b22', borderColor: '#21262d' }}>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid #21262d' }}>
                    {['Instance', 'Name', 'Physical backup', 'Last recoverable time', 'Created', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pitrRows.length === 0 ? <EmptyRow colSpan={6} text="No Point-in-Time Recovery resources found." /> : pitrRows.map((p, i) => (
                    <tr key={`${p.namespace}/${p.name}`} style={{ borderBottom: i < pitrRows.length - 1 ? '1px solid #21262d' : 'none' }}>
                      <td className="px-4 py-3 text-xs">
                        <button onClick={() => goToInstance(p.namespace, p.instanceName)}
                          style={{ color: '#58a6ff', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          {p.namespace}/{p.instanceName}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: '#e6edf3' }}>{p.name}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{p.spec?.physicalBackupRef?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-xs font-mono" style={{ color: '#8b949e' }}>{p.status?.lastRecoverableTime ?? '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#8b949e' }}>{relTime(p.creationTimestamp)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setDeleteTarget({ kind: 'pointintimerecovery', namespace: p.namespace, name: p.name, label: `PITR "${p.name}"` })}
                          title="Delete" style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showNewBackup && newBackupInstance && (() => {
        const [namespace, instanceName] = newBackupInstance.split('/')
        return (
          <CreateResourceModal
            schema={CRD_SCHEMAS.backup}
            namespace={namespace}
            instanceName={instanceName}
            title={`New Backup for ${namespace}/${instanceName}`}
            onClose={() => setShowNewBackup(false)}
            onCreated={load}
          />
        )
      })()}

      {restoreTarget && (
        <CreateResourceModal
          schema={CRD_SCHEMAS.restore}
          namespace={restoreTarget.namespace}
          instanceName={restoreTarget.spec?.mariaDbRef?.name}
          title={`Restore "${restoreTarget.name}" into ${restoreTarget.namespace}/${restoreTarget.spec?.mariaDbRef?.name}`}
          prefill={{ name: `${restoreTarget.name}-restore`, backupRef: restoreTarget.name }}
          onClose={() => setRestoreTarget(null)}
          onCreated={load}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl border p-6" style={{ background: '#161b22', borderColor: '#21262d' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: '#e6edf3' }}>Delete {deleteTarget.label}?</h3>
            <p className="text-sm mb-5" style={{ color: '#8b949e' }}>
              This will delete it from namespace <span className="font-mono">{deleteTarget.namespace}</span>. This cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: '#f85149', color: 'white', opacity: deleting ? 0.7 : 1 }}>
                {deleting && <Loader2 size={14} className="animate-spin" />}
                Delete
              </button>
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ color: '#8b949e', borderColor: '#30363d', background: 'transparent' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
