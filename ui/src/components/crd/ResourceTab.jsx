import { useState, useEffect, useCallback } from 'react'
import * as Icons from 'lucide-react'
import { Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react'
import CreateResourceModal from './CreateResourceModal'
import { getByPath, statusFromConditions } from '../../lib/crdSchemas'

// Generic list+create+delete panel for a single CRD kind, driven by a CRD_SCHEMAS entry.
// Used both as an InstanceDetail tab (namespace + instanceName scoped to that MariaDB) and
// as a standalone page for cluster-level kinds like MaxScale (instanceName omitted).
export default function ResourceTab({ schema, namespace, instanceName }) {
  const [items, setItems]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const Icon = Icons[schema.icon] || Icons.Box

  const fetchItems = useCallback(async () => {
    if (!namespace) return
    try {
      const params = new URLSearchParams({ namespace })
      if (instanceName && schema.scope === 'instance') {
        params.set('ref', instanceName)
        params.set('refField', 'mariaDbRef')
      }
      const res = await fetch(`/api/crd/${schema.kind}?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setItems(data.items)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [schema.kind, schema.scope, namespace, instanceName])

  useEffect(() => { fetchItems() }, [fetchItems])

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/crd/${schema.kind}/${deleteTarget.namespace}/${deleteTarget.name}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDeleteTarget(null)
      fetchItems()
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs" style={{ color: '#8b949e' }}>{items.length} {items.length === 1 ? schema.label : schema.pluralLabel}</p>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white' }}
        >
          <Plus size={13} strokeWidth={2.5} />
          New {schema.label}
        </button>
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
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <Icon size={24} className="mx-auto mb-2" style={{ color: '#30363d' }} />
            <p className="text-sm" style={{ color: '#8b949e' }}>No {schema.pluralLabel} yet.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid #21262d' }}>
                {schema.columns.map(c => (
                  <th key={c.key} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>{c.label}</th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={`${item.namespace}/${item.name}`} style={{ borderBottom: i < items.length - 1 ? '1px solid #21262d' : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {schema.columns.map(c => {
                    const raw = getByPath(item, c.key)
                    const render = c.render || (c.key === 'status' ? statusFromConditions : null)
                    const val = render ? render(raw, item) : (raw ?? '—')
                    return (
                      <td key={c.key} className="px-4 py-3 text-xs" style={{ color: c.key === 'name' ? '#e6edf3' : '#8b949e', fontWeight: c.key === 'name' ? 500 : 400 }}>
                        {String(val)}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleteTarget(item)}
                      title="Delete"
                      style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#f85149'}
                      onMouseLeave={e => e.currentTarget.style.color = '#8b949e'}
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

      {showCreate && (
        <CreateResourceModal
          schema={schema}
          namespace={namespace}
          instanceName={instanceName}
          onClose={() => setShowCreate(false)}
          onCreated={fetchItems}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm rounded-xl border p-6" style={{ background: '#161b22', borderColor: '#21262d' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: '#e6edf3' }}>Delete {schema.label}?</h3>
            <p className="text-sm mb-5" style={{ color: '#8b949e' }}>
              This will delete <span className="font-mono" style={{ color: '#e6edf3' }}>{deleteTarget.name}</span> from namespace <span className="font-mono">{deleteTarget.namespace}</span>. This cannot be undone.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: '#f85149', color: 'white', opacity: deleting ? 0.7 : 1 }}
              >
                {deleting && <Loader2 size={13} className="animate-spin" />}
                Delete
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ color: '#8b949e', borderColor: '#30363d', background: 'transparent' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
