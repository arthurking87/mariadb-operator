import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle } from 'lucide-react'
import { setPath, genericBuildSpec, initialValues, fieldActive, slugify } from './formUtils'

const K8S_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

const inputStyle = { background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1" style={{ color: '#e6edf3' }}>{label}</label>
      {hint && <p className="text-xs mb-1.5" style={{ color: '#8b949e' }}>{hint}</p>}
      {children}
    </div>
  )
}

// Fetches options for a `ref-select` field: either other MariaDB instances (for
// MaxScale's mariaDbRef, which isn't scoped to any single instance) or another CRD kind's
// list scoped to the current instance (e.g. Restore -> which Backup).
function useRefOptions(field, namespace, instanceName) {
  const [options, setOptions] = useState([])
  useEffect(() => {
    if (!field) return
    if (field.refKind === 'mariadb') {
      fetch('/api/instances').then(r => r.json()).then(d => {
        setOptions((d.instances || []).filter(i => i.namespace === namespace).map(i => i.name))
      }).catch(() => setOptions([]))
    } else {
      fetch(`/api/crd/${field.refKind}?namespace=${namespace}&ref=${instanceName}&refField=mariaDbRef`)
        .then(r => r.json())
        .then(d => setOptions((d.items || []).map(i => i.name)))
        .catch(() => setOptions([]))
    }
  }, [field, namespace, instanceName])
  return options
}

function FieldInput({ field, value, onChange, namespace, instanceName }) {
  const refOptions = useRefOptions(field.type === 'ref-select' ? field : null, namespace, instanceName)

  switch (field.type) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm" style={{ color: '#e6edf3' }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
          {field.label}
        </label>
      )
    case 'select':
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm border" style={inputStyle}>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'ref-select':
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm border" style={inputStyle}>
          <option value="">Select…</option>
          {refOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'multiselect':
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options.map(o => {
            const on = (value || []).includes(o)
            return (
              <button
                key={o} type="button"
                onClick={() => onChange(on ? value.filter(v => v !== o) : [...value, o])}
                className="px-2.5 py-1 rounded-md text-xs font-medium border transition-all"
                style={{
                  background: on ? 'rgba(249,115,22,0.12)' : 'transparent',
                  borderColor: on ? '#f97316' : '#30363d',
                  color: on ? '#f97316' : '#8b949e',
                }}
              >{o}</button>
            )
          })}
        </div>
      )
    case 'textarea':
      return (
        <textarea
          value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder}
          rows={field.rows || 4}
          className="w-full px-3 py-2 rounded-lg text-sm border font-mono"
          style={inputStyle}
        />
      )
    case 'password':
      return (
        <input
          type="password" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder}
          autoComplete="new-password"
          className="w-full px-3 py-2 rounded-lg text-sm border" style={inputStyle}
        />
      )
    case 'number':
      return (
        <input
          type="number" value={value} onChange={e => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm border" style={inputStyle}
        />
      )
    default:
      return (
        <input
          type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder}
          className="w-full px-3 py-2 rounded-lg text-sm border" style={inputStyle}
        />
      )
  }
}

// Generic "Create <Resource>" modal driven entirely by a CRD_SCHEMAS entry. Handles the
// password -> Secret -> *SecretKeyRef flow transparently: if the schema has any password
// field, a Secret named `<resource-name>-<field-key>` is created first via POST
// /api/secrets, then the CR is created referencing it.
export default function CreateResourceModal({ schema, namespace, instanceName, onClose, onCreated }) {
  const [values, setValues] = useState(initialValues(schema))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const setField = (key, val) => setValues(v => ({ ...v, [key]: val }))

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const name = values.name?.trim()
      if (!name) throw new Error('Name is required')
      if (!K8S_NAME_RE.test(name)) throw new Error('Name must be lowercase alphanumeric characters or "-" (e.g. my-backup)')
      for (const f of schema.fields) {
        if (!fieldActive(f, values)) continue
        if (f.required && (values[f.key] === '' || values[f.key] === undefined || (Array.isArray(values[f.key]) && values[f.key].length === 0))) {
          throw new Error(`"${f.label}" is required`)
        }
      }

      // Create any password-backed Secrets first. Tracked per field key (not a single
      // shared variable) since a schema can have more than one password field active at
      // once — e.g. S3 access key id + secret access key.
      const passwordFields = schema.fields.filter(f => f.type === 'password' && fieldActive(f, values))
      const secretNames = {}
      for (const f of passwordFields) {
        secretNames[f.key] = `${name}-${slugify(f.key)}`
        const res = await fetch('/api/secrets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ namespace, name: secretNames[f.key], literals: { [f.secretKey]: values[f.key] } }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to create Secret')
      }

      const ctx = { instanceName, secretNames }
      let spec = schema.buildSpec ? schema.buildSpec(values, ctx) : genericBuildSpec(schema, values, ctx)
      if (instanceName) {
        spec = JSON.parse(JSON.stringify(spec).replace(/"__INSTANCE__"/g, JSON.stringify(instanceName)))
      }

      const res = await fetch(`/api/crd/${schema.kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace, name, spec }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create resource')

      onCreated()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border p-6 max-h-[85vh] overflow-y-auto"
        style={{ background: '#161b22', borderColor: '#21262d' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: '#e6edf3' }}>New {schema.label}</h2>
          <button onClick={onClose} style={{ color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {schema.fields.filter(f => fieldActive(f, values)).map(f => (
          <Field key={f.key} label={f.label} hint={f.help}>
            <FieldInput field={f} value={values[f.key]} onChange={v => setField(f.key, v)} namespace={namespace} instanceName={instanceName} />
          </Field>
        ))}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
            <AlertCircle size={15} />{error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border"
            style={{ color: '#8b949e', borderColor: '#30363d', background: 'transparent' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
