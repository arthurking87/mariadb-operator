import { useState, useEffect } from 'react'
import * as Icons from 'lucide-react'
import ResourceTab from '../components/crd/ResourceTab'
import { getSettings } from '../lib/settings'

// Shared page shell for CRDs that aren't scoped to a single MariaDB instance
// (MaxScale, ExternalMariaDB) — same list/create/delete UI as the per-instance tabs, but
// with its own namespace picker up top instead of inheriting one from InstanceDetail.
export default function StandaloneCrdPage({ schema }) {
  const [namespaces, setNamespaces] = useState([])
  const [namespace, setNamespace]   = useState(getSettings().defaultNamespace || '')
  const Icon = Icons[schema.icon] || Icons.Box

  useEffect(() => {
    fetch('/api/namespaces').then(r => r.json()).then(d => {
      setNamespaces(d.namespaces || [])
      if (!namespace && d.namespaces?.length) setNamespace(d.namespaces[0])
    }).catch(() => {})
  }, [])

  return (
    <div className="px-8 py-8 max-w-[1800px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3.5">
          {/* Page-title badge, aligned with the w-11/icon-20/bordered treatment used
              throughout the rest of the app (see Dashboard.jsx). */}
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border"
            style={{ background: schema.accent + '1f', borderColor: schema.accent + '4d' }}>
            <Icon size={20} color={schema.accent} strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#e6edf3' }}>{schema.pluralLabel}</h1>
            <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>Cluster-level resource, not tied to a single instance.</p>
          </div>
        </div>
        <select
          value={namespace}
          onChange={e => setNamespace(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border"
          style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
        >
          {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
        </select>
      </div>

      {namespace
        ? <ResourceTab schema={schema} namespace={namespace} instanceName={null} />
        : <p className="text-sm" style={{ color: '#8b949e' }}>Loading namespaces…</p>}
    </div>
  )
}
