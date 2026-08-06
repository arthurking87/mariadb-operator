import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Database, Loader2 } from 'lucide-react'
import * as Icons from 'lucide-react'
import { CRD_SCHEMAS } from '../lib/crdSchemas'

function ResultIcon({ kind, crdKind }) {
  if (kind === 'MariaDB') return <Database size={13} color="#f97316" />
  const schema = crdKind && CRD_SCHEMAS[crdKind]
  const Icon = schema ? (Icons[schema.icon] || Icons.Box) : Icons.Box
  return <Icon size={13} color={schema?.accent || '#8b949e'} />
}

export default function GlobalSearch({ navigate }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const debounceRef = useRef(null)

  const runSearch = useCallback((term) => {
    if (!term.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(term.trim())}`)
      .then(r => r.json())
      .then(d => setResults(d.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(q), 250)
    return () => clearTimeout(debounceRef.current)
  }, [q, runSearch])

  useEffect(() => {
    const onClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [])

  const go = (result) => {
    if (result.kind === 'MariaDB') {
      navigate('detail', { namespace: result.namespace, name: result.instanceName })
    } else if (result.instanceName) {
      navigate('detail', { namespace: result.namespace, name: result.instanceName, tab: 'crds', crdKind: result.crdKind })
    } else {
      // namespace-scoped kind with no owning instance (MaxScale, ExternalMariaDB, standalone PITR) —
      // nothing to deep-link into yet, so just surface it was found rather than 404ing.
      return
    }
    setOpen(false)
    setQ('')
    setResults([])
  }

  return (
    <div ref={boxRef} className="relative w-80">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border" style={{ background: '#0d1117', borderColor: open ? '#f97316' : '#30363d' }}>
        <Search size={14} color="#8b949e" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search instances, users, backups…"
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: '#e6edf3' }}
        />
        {loading && <Loader2 size={13} className="animate-spin" color="#8b949e" />}
        {!loading && q && (
          <button onClick={() => { setQ(''); setResults([]) }} style={{ color: '#8b949e' }}><X size={13} /></button>
        )}
      </div>

      {open && q.trim() && (
        <div className="absolute top-full mt-1.5 w-full rounded-lg border overflow-hidden z-50" style={{ background: '#161b22', borderColor: '#30363d', maxHeight: 320, overflowY: 'auto' }}>
          {!loading && results.length === 0 && (
            <div className="px-3 py-3 text-xs" style={{ color: '#8b949e' }}>No matches for "{q}".</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.namespace}-${r.name}-${i}`}
              onClick={() => go(r)}
              disabled={r.kind !== 'MariaDB' && !r.instanceName}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
              style={{ background: 'transparent', cursor: r.kind === 'MariaDB' || r.instanceName ? 'pointer' : 'default', borderBottom: i < results.length - 1 ? '1px solid #21262d' : 'none' }}
              onMouseEnter={e => e.currentTarget.style.background = '#1c2330'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <ResultIcon kind={r.kind} crdKind={r.crdKind} />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate" style={{ color: '#e6edf3' }}>{r.name}</div>
                <div className="text-xs truncate" style={{ color: '#8b949e' }}>
                  {r.kind} · {r.namespace}{r.instanceName && r.kind !== 'MariaDB' ? ` · on ${r.instanceName}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
