import { useState, useEffect, useCallback, useMemo } from 'react'
import { Plus, Trash2, AlertCircle, Loader2, X, Info, KeyRound } from 'lucide-react'
import CreateResourceModal from './CreateResourceModal'
import { CRD_SCHEMAS } from '../../lib/crdSchemas'

const ALL_DBS = '*'

function PrivilegeBadges({ privileges }) {
  if (!privileges || privileges.length === 0) return <span style={{ color: '#8b949e' }}>—</span>
  if (privileges.includes('ALL PRIVILEGES')) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(248,81,73,0.15)', color: '#f85149' }}>
        ALL PRIVILEGES
      </span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {privileges.map(p => (
        <span key={p} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(88,166,255,0.12)', color: '#58a6ff' }}>
          {p}
        </span>
      ))}
    </div>
  )
}

// Matrix cell: aggregates every Grant CR that exactly matches (username, database) — does
// NOT fold in privileges inherited from a '*' grant into the specific-database columns,
// since that would make it unclear which Grant CR a privilege actually came from. The '*'
// column is where wildcard grants show up; a note above the table explains that.
function Cell({ user, dbKey, grants, onOpen }) {
  const matching = grants.filter(g => g.spec?.username === user && (g.spec?.database || ALL_DBS) === dbKey)
  const empty = matching.length === 0
  return (
    <button
      onClick={() => onOpen(user, dbKey, matching)}
      className="w-full h-full text-left px-3 py-2.5 transition-colors"
      style={{ background: 'transparent', border: 'none', cursor: 'pointer', minHeight: 46 }}
      onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      title={empty ? 'Click to grant a privilege' : `${matching.length} grant${matching.length === 1 ? '' : 's'} — click for details`}
    >
      {empty ? (
        <span style={{ color: '#30363d' }}>·</span>
      ) : (
        <div className="space-y-1">
          {matching.map(g => (
            <div key={g.name}>
              <PrivilegeBadges privileges={g.spec?.privileges} />
              {(g.spec?.table && g.spec.table !== '*') || (g.spec?.host && g.spec.host !== '%') ? (
                <div className="text-[9px] mt-0.5" style={{ color: '#8b949e' }}>
                  {g.spec?.table && g.spec.table !== '*' ? `table ${g.spec.table}` : ''}
                  {g.spec?.table && g.spec.table !== '*' && g.spec?.host && g.spec.host !== '%' ? ' · ' : ''}
                  {g.spec?.host && g.spec.host !== '%' ? `from ${g.spec.host}` : ''}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </button>
  )
}

// Permission matrix for a single instance: Users (rows) x Databases (columns), aggregating
// existing Grant CRs into each cell. Replaces having to page through the flat Grants list
// (raw CrdsPanel tab, still available for full CRUD) to answer "what can user X do on
// database Y" — that used to require scanning every Grant's username/database fields by eye.
export default function PermissionsMatrix({ namespace, instanceName }) {
  const [users, setUsers] = useState(null)
  const [grants, setGrants] = useState(null)
  const [databases, setDatabases] = useState(null)
  const [error, setError] = useState(null)
  const [cellTarget, setCellTarget] = useState(null) // { user, dbKey, grants }
  const [createTarget, setCreateTarget] = useState(null) // { user, dbKey } -> shows CreateResourceModal
  const [deleteTarget, setDeleteTarget] = useState(null) // a single grant item
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!namespace || !instanceName) return
    try {
      const qs = new URLSearchParams({ namespace, ref: instanceName, refField: 'mariaDbRef' })
      const [uRes, gRes, dRes] = await Promise.all([
        fetch(`/api/crd/user?${qs}`),
        fetch(`/api/crd/grant?${qs}`),
        fetch(`/api/crd/database?${qs}`),
      ])
      const [uData, gData, dData] = await Promise.all([uRes.json(), gRes.json(), dRes.json()])
      for (const d of [uData, gData, dData]) if (d.error) throw new Error(d.error)
      setUsers(uData.items ?? [])
      setGrants(gData.items ?? [])
      setDatabases(dData.items ?? [])
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [namespace, instanceName])

  useEffect(() => { load() }, [load])

  const loading = users === null || grants === null || databases === null

  // Rows/columns are the union of what exists as a CR and what only shows up referenced
  // inside a Grant (e.g. a Grant for the built-in "root" user, which has no User CR of its
  // own; or a Grant targeting a database that was created outside this UI). Hiding those
  // would make real, active grants invisible.
  const rowUsers = useMemo(() => {
    if (!users || !grants) return []
    const fromCRs = users.map(u => u.name)
    const fromGrants = grants.map(g => g.spec?.username).filter(Boolean)
    return Array.from(new Set([...fromCRs, ...fromGrants])).sort()
  }, [users, grants])

  const columns = useMemo(() => {
    if (!databases || !grants) return [ALL_DBS]
    const fromCRs = databases.map(d => d.name)
    const fromGrants = grants.map(g => g.spec?.database).filter(d => d && d !== ALL_DBS)
    return [ALL_DBS, ...Array.from(new Set([...fromCRs, ...fromGrants])).sort()]
  }, [databases, grants])

  const userHost = name => users?.find(u => u.name === name)?.spec?.host

  const handleOpenCell = (user, dbKey, matching) => setCellTarget({ user, dbKey, grants: matching })

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/crd/grant/${namespace}/${deleteTarget.name}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDeleteTarget(null)
      setCellTarget(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="inline-block w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#30363d', borderTopColor: '#f97316' }} />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start gap-2 p-3 rounded-lg mb-4 text-xs" style={{ background: 'rgba(88,166,255,0.08)', color: '#8b949e', border: '1px solid rgba(88,166,255,0.2)' }}>
        <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#58a6ff' }} />
        <span>
          Each cell shows Grant resources that <em>exactly</em> target that user + database. A privilege in the
          <span className="font-mono px-1" style={{ color: '#58a6ff' }}>* (all)</span>
          column applies to every database, not just the ones listed here — it isn't repeated in the other columns.
          Click any cell to see the underlying Grant(s) or add a new one.
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
          <AlertCircle size={15} />{error}
        </div>
      )}

      {rowUsers.length === 0 ? (
        <div className="text-center py-16 rounded-xl border" style={{ background: '#161b22', borderColor: '#21262d' }}>
          <KeyRound size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
          <p className="text-sm" style={{ color: '#8b949e' }}>No Users or Grants yet — create a User in the Users tab first.</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ background: '#161b22', borderColor: '#21262d' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider sticky left-0" style={{ color: '#8b949e', background: '#161b22' }}>User</th>
                {columns.map(c => (
                  <th key={c} className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider whitespace-nowrap" style={{ color: c === ALL_DBS ? '#f97316' : '#8b949e' }}>
                    {c === ALL_DBS ? '* (all)' : c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowUsers.map((u, i) => (
                <tr key={u} style={{ borderBottom: i < rowUsers.length - 1 ? '1px solid #21262d' : 'none' }}>
                  <td className="px-3 py-2.5 text-xs font-mono sticky left-0" style={{ color: '#e6edf3', background: '#161b22' }}>
                    {u}
                    {userHost(u) && userHost(u) !== '%' && (
                      <div className="text-[9px] font-sans" style={{ color: '#8b949e' }}>@{userHost(u)}</div>
                    )}
                    {!users.some(x => x.name === u) && (
                      <div className="text-[9px] font-sans" style={{ color: '#d29922' }}>no User CR</div>
                    )}
                  </td>
                  {columns.map(dbKey => (
                    <td key={dbKey} className="p-0" style={{ borderLeft: '1px solid #21262d' }}>
                      <Cell user={u} dbKey={dbKey} grants={grants} onOpen={handleOpenCell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cell detail: list existing grants for this (user, database) + add new */}
      {cellTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setCellTarget(null)}>
          <div className="w-full max-w-md rounded-xl border p-6" style={{ background: '#161b22', borderColor: '#21262d' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>
                {cellTarget.user} <span style={{ color: '#8b949e' }}>on</span> {cellTarget.dbKey === ALL_DBS ? '* (all databases)' : cellTarget.dbKey}
              </h3>
              <button onClick={() => setCellTarget(null)} style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>

            {cellTarget.grants.length === 0 ? (
              <p className="text-xs mb-4" style={{ color: '#8b949e' }}>No Grant resources here yet.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {cellTarget.grants.map(g => (
                  <div key={g.name} className="flex items-start justify-between p-2.5 rounded-lg border" style={{ borderColor: '#30363d' }}>
                    <div>
                      <div className="text-xs font-mono mb-1" style={{ color: '#e6edf3' }}>{g.name}</div>
                      <PrivilegeBadges privileges={g.spec?.privileges} />
                      <div className="text-[10px] mt-1" style={{ color: '#8b949e' }}>
                        table {g.spec?.table || '*'} · host {g.spec?.host || '%'}{g.spec?.grantOption ? ' · WITH GRANT OPTION' : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => setDeleteTarget(g)}
                      title="Delete grant"
                      style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.color = '#f85149'}
                      onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => { setCreateTarget({ user: cellTarget.user, dbKey: cellTarget.dbKey }); setCellTarget(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white' }}
            >
              <Plus size={13} strokeWidth={2.5} />
              Add Grant
            </button>
          </div>
        </div>
      )}

      {createTarget && (
        <CreateResourceModal
          schema={CRD_SCHEMAS.grant}
          namespace={namespace}
          instanceName={instanceName}
          title={`New Grant for ${createTarget.user} on ${createTarget.dbKey === ALL_DBS ? '* (all databases)' : createTarget.dbKey}`}
          prefill={{
            username: createTarget.user,
            database: createTarget.dbKey,
            host: userHost(createTarget.user) || '%',
          }}
          onClose={() => setCreateTarget(null)}
          onCreated={load}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl border p-6" style={{ background: '#161b22', borderColor: '#21262d' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: '#e6edf3' }}>Delete Grant "{deleteTarget.name}"?</h3>
            <p className="text-sm mb-5" style={{ color: '#8b949e' }}>This cannot be undone.</p>
            <div className="flex items-center gap-2">
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: '#f85149', color: 'white', opacity: deleting ? 0.7 : 1 }}>
                {deleting && <Loader2 size={13} className="animate-spin" />}
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
