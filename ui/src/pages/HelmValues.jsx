import { useState, useEffect, useCallback } from 'react'
import {
  Settings, ChevronDown, ChevronRight, Loader2, AlertCircle,
  CheckCircle2, RefreshCw, Zap, Copy, Check, Info,
  Server, Shield, Activity, Image, BarChart2,
} from 'lucide-react'

// ── tiny primitives ───────────────────────────────────────────────────────────

function Label({ children, hint }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <label className="text-sm font-medium" style={{ color: '#e6edf3' }}>{children}</label>
      {hint && <Info size={12} style={{ color: '#8b949e' }} title={hint} />}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      {label && <Label hint={hint}>{label}</Label>}
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono }) {
  return (
    <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className={`w-full px-3 py-2 rounded-lg text-sm border outline-none transition-colors ${mono ? 'font-mono' : ''}`}
      style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
      onFocus={e => e.target.style.borderColor = '#f97316'}
      onBlur={e => e.target.style.borderColor = '#30363d'} />
  )
}

function NumberInput({ value, onChange, min, max, step = 1 }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
      min={min} max={max} step={step}
      className="w-full px-3 py-2 rounded-lg text-sm border outline-none"
      style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
      onFocus={e => e.target.style.borderColor = '#f97316'}
      onBlur={e => e.target.style.borderColor = '#30363d'} />
  )
}

function SelectInput({ value, onChange, options }) {
  return (
    <div className="relative">
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 pr-8 rounded-lg text-sm border outline-none appearance-none"
        style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
        onFocus={e => e.target.style.borderColor = '#f97316'}
        onBlur={e => e.target.style.borderColor = '#30363d'}>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8b949e' }} />
    </div>
  )
}

function Toggle({ checked, onChange, label, desc }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-sm" style={{ color: '#e6edf3' }}>{label}</div>
        {desc && <div className="text-xs mt-0.5" style={{ color: '#8b949e' }}>{desc}</div>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        style={{ background: checked ? '#f97316' : '#30363d', height: 22, width: 40, borderRadius: 11, position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'transform .2s', transform: checked ? 'translateX(18px)' : 'none' }} />
      </button>
    </div>
  )
}

function ResourceInputs({ label, req, lim, onReqChange, onLimChange }) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs mb-1" style={{ color: '#8b949e' }}>Request</div>
          <TextInput value={req} onChange={onReqChange} placeholder="e.g. 100m / 128Mi" mono />
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: '#8b949e' }}>Limit</div>
          <TextInput value={lim} onChange={onLimChange} placeholder="e.g. 500m / 512Mi" mono />
        </div>
      </div>
    </div>
  )
}

// ── accordion section ─────────────────────────────────────────────────────────

function Section({ icon: Icon, title, accent = '#8b949e', defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#21262d' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 w-full px-5 py-4 text-left transition-colors"
        style={{ background: open ? '#1c2330' : '#161b22' }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#1c2330' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = '#161b22' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: accent + '22' }}>
          <Icon size={14} color={accent} />
        </div>
        <span className="text-sm font-semibold flex-1" style={{ color: '#e6edf3' }}>{title}</span>
        {badge && <span className="text-xs px-2 py-0.5 rounded-full mr-2" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>{badge}</span>}
        {open ? <ChevronDown size={14} style={{ color: '#8b949e' }} /> : <ChevronRight size={14} style={{ color: '#8b949e' }} />}
      </button>
      {open && (
        <div className="px-5 py-4 border-t space-y-4" style={{ background: '#161b22', borderColor: '#21262d' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── YAML preview ──────────────────────────────────────────────────────────────

function buildYAML(v) {
  const lines = []
  const add = (key, val, indent = 0) => {
    const pad = '  '.repeat(indent)
    if (val === null || val === undefined || val === '') return
    if (typeof val === 'object' && !Array.isArray(val)) {
      const sub = Object.entries(val).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      if (!sub.length) return
      lines.push(`${pad}${key}:`)
      sub.forEach(([k, v2]) => add(k, v2, indent + 1))
    } else {
      lines.push(`${pad}${key}: ${typeof val === 'string' ? `"${val}"` : val}`)
    }
  }
  Object.entries(v).forEach(([k, val]) => add(k, val))
  return lines.join('\n') || '# (no changes from defaults)'
}

function YAMLPreview({ values, original }) {
  const [copied, setCopied] = useState(false)
  const yaml = buildYAML(values)

  const copy = () => { navigator.clipboard.writeText(yaml); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  // compute changed keys for highlighting
  const changedKeys = new Set()
  const findChanged = (curr, orig, path = '') => {
    Object.keys(curr).forEach(k => {
      const fp = path ? `${path}.${k}` : k
      if (typeof curr[k] === 'object' && curr[k] !== null && !Array.isArray(curr[k])) {
        findChanged(curr[k], orig?.[k] ?? {}, fp)
      } else if (JSON.stringify(curr[k]) !== JSON.stringify(orig?.[k])) {
        changedKeys.add(fp.split('.')[0])
      }
    })
  }
  findChanged(values, original)

  return (
    <div className="sticky top-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#8b949e' }}>Values YAML</span>
        <div className="flex items-center gap-2">
          {changedKeys.size > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>
              {changedKeys.size} section{changedKeys.size !== 1 ? 's' : ''} changed
            </span>
          )}
          <button onClick={copy} className="flex items-center gap-1 text-xs px-2 py-1 rounded border"
            style={{ borderColor: '#30363d', color: copied ? '#3fb950' : '#8b949e' }}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="rounded-xl p-4 text-xs overflow-auto"
        style={{ background: '#010409', color: '#c9d1d9', border: '1px solid #21262d', lineHeight: 1.7, maxHeight: 'calc(100vh - 220px)' }}>
        {yaml}
      </pre>
    </div>
  )
}

// ── helpers to read deeply ────────────────────────────────────────────────────

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)

// ── main page ─────────────────────────────────────────────────────────────────

export default function HelmValues() {
  const [allValues,  setAllValues]  = useState(null)
  const [userValues, setUserValues] = useState(null)
  const [form,       setForm]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [applying,   setApplying]   = useState(false)
  const [applyResult, setApplyResult] = useState(null)

  const fetchValues = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/helm/values')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAllValues(data.all)
      setUserValues(data.user)
      setForm(initForm(data.all))
      setError(null)
    } catch (e) { setError(e.message) }
    finally     { setLoading(false) }
  }, [])

  useEffect(() => { fetchValues() }, [fetchValues])

  const set = useCallback((path, value) => {
    setForm(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      const keys = path.split('.')
      let cur = next
      keys.slice(0, -1).forEach(k => { cur[k] ??= {}; cur = cur[k] })
      cur[keys.at(-1)] = value
      return next
    })
  }, [])

  const apply = async () => {
    setApplying(true); setApplyResult(null)
    try {
      const res  = await fetch('/api/helm/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      setApplyResult(data.ok ? { ok: true } : { ok: false, error: data.error })
      if (data.ok) fetchValues()
    } catch (e) { setApplyResult({ ok: false, error: e.message }) }
    finally     { setApplying(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-24" style={{ color: '#8b949e' }}>
      <Loader2 size={18} className="animate-spin" /><span className="text-sm">Loading Helm values…</span>
    </div>
  )
  if (error) return (
    <div className="px-8 py-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
        <AlertCircle size={15} />{error}
      </div>
    </div>
  )

  const f = form
  const yamlValues = buildFormValues(f)

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e6edf3' }}>Operator Settings</h1>
          <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>
            Advanced Helm chart values for <span className="font-mono" style={{ color: '#e6edf3' }}>mariadb-operator</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchValues} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border"
            style={{ background: 'transparent', borderColor: '#30363d', color: '#8b949e' }}>
            <RefreshCw size={13} />Reset
          </button>
          <button onClick={apply} disabled={applying}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: applying ? '#30363d' : 'linear-gradient(135deg,#f97316,#ea580c)', color: applying ? '#8b949e' : 'white', boxShadow: applying ? 'none' : '0 0 16px rgba(249,115,22,0.2)', cursor: applying ? 'not-allowed' : 'pointer' }}>
            {applying ? <><Loader2 size={14} className="animate-spin" />Applying…</> : <><Zap size={14} />Apply Changes</>}
          </button>
        </div>
      </div>

      {/* Apply result banner */}
      {applyResult && (
        <div className="flex items-center gap-2 p-3 rounded-lg mb-6 text-sm"
          style={{ background: applyResult.ok ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)', color: applyResult.ok ? '#3fb950' : '#f85149', border: `1px solid ${applyResult.ok ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}` }}>
          {applyResult.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {applyResult.ok ? 'Helm upgrade applied successfully.' : applyResult.error}
        </div>
      )}

      {/* Split layout */}
      <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 380px' }}>

        {/* Left: accordion sections */}
        <div className="space-y-3">

          {/* Operator */}
          <Section icon={Server} title="Operator" accent="#58a6ff" defaultOpen>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Log Level" hint="Controller verbosity">
                <SelectInput value={f.logLevel} onChange={v => set('logLevel', v)}
                  options={['DEBUG','INFO','WARN','ERROR'].map(v => ({ value: v, label: v }))} />
              </Field>
              <Field label="Cluster DNS Name" hint="Used for internal DNS resolution">
                <TextInput value={f.clusterName} onChange={v => set('clusterName', v)} placeholder="cluster.local" mono />
              </Field>
            </div>
            <Toggle label="Watch all namespaces"
              desc="If disabled, the operator only watches its own namespace"
              checked={!f.currentNamespaceOnly}
              onChange={v => set('currentNamespaceOnly', !v)} />
            <div style={{ borderTop: '1px solid #21262d' }} />
            <div className="grid grid-cols-2 gap-4">
              <Toggle label="High Availability" desc="Run multiple operator replicas"
                checked={f.ha?.enabled ?? false} onChange={v => set('ha.enabled', v)} />
              {f.ha?.enabled && (
                <Field label="Replicas">
                  <NumberInput value={f.ha?.replicas ?? 3} onChange={v => set('ha.replicas', v)} min={2} max={10} />
                </Field>
              )}
            </div>
            <div style={{ borderTop: '1px solid #21262d' }} />
            <div className="grid grid-cols-2 gap-4">
              <ResourceInputs label="CPU"
                req={get(f,'resources.requests.cpu')}   lim={get(f,'resources.limits.cpu')}
                onReqChange={v => set('resources.requests.cpu', v)} onLimChange={v => set('resources.limits.cpu', v)} />
              <ResourceInputs label="Memory"
                req={get(f,'resources.requests.memory')} lim={get(f,'resources.limits.memory')}
                onReqChange={v => set('resources.requests.memory', v)} onLimChange={v => set('resources.limits.memory', v)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Revision History Limit" hint="Number of old ReplicaSets to keep">
                <NumberInput value={f.revisionHistoryLimit ?? 10} onChange={v => set('revisionHistoryLimit', v)} min={0} max={50} />
              </Field>
            </div>
          </Section>

          {/* Webhook */}
          <Section icon={Shield} title="Webhook" accent="#3fb950">
            <Toggle label="Enabled" desc="Validating and defaulting webhooks for MariaDB CRDs"
              checked={f.webhook?.enabled ?? true} onChange={v => set('webhook.enabled', v)} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Port" hint="Webhook server port">
                <NumberInput value={f.webhook?.port ?? 10250} onChange={v => set('webhook.port', v)} min={1024} max={65535} />
              </Field>
            </div>
            <Toggle label="High Availability" checked={f.webhook?.ha?.enabled ?? false}
              onChange={v => set('webhook.ha.enabled', v)}
              desc="Run multiple webhook replicas" />
            {f.webhook?.ha?.enabled && (
              <Field label="Webhook Replicas">
                <NumberInput value={f.webhook?.ha?.replicas ?? 3} onChange={v => set('webhook.ha.replicas', v)} min={2} max={10} />
              </Field>
            )}
            <div style={{ borderTop: '1px solid #21262d' }} />
            <div className="grid grid-cols-2 gap-4">
              <ResourceInputs label="CPU"
                req={get(f,'webhook.resources.requests.cpu')}    lim={get(f,'webhook.resources.limits.cpu')}
                onReqChange={v => set('webhook.resources.requests.cpu', v)} onLimChange={v => set('webhook.resources.limits.cpu', v)} />
              <ResourceInputs label="Memory"
                req={get(f,'webhook.resources.requests.memory')} lim={get(f,'webhook.resources.limits.memory')}
                onReqChange={v => set('webhook.resources.requests.memory', v)} onLimChange={v => set('webhook.resources.limits.memory', v)} />
            </div>
          </Section>

          {/* Cert Controller */}
          <Section icon={Shield} title="Cert Controller" accent="#bc8cff">
            <Toggle label="Enabled" desc="Manages TLS certificates for the webhook"
              checked={f.certController?.enabled ?? true} onChange={v => set('certController.enabled', v)} />
            <div className="grid grid-cols-3 gap-4">
              <Field label="CA Lifetime" hint="e.g. 26280h = 3 years">
                <TextInput value={f.certController?.caLifetime ?? '26280h'} onChange={v => set('certController.caLifetime', v)} mono />
              </Field>
              <Field label="Cert Lifetime" hint="e.g. 2160h = 90 days">
                <TextInput value={f.certController?.certLifetime ?? '2160h'} onChange={v => set('certController.certLifetime', v)} mono />
              </Field>
              <Field label="Renew Before %" hint="Renew cert when this % of lifetime remains">
                <NumberInput value={f.certController?.renewBeforePercentage ?? 33} onChange={v => set('certController.renewBeforePercentage', v)} min={1} max={99} />
              </Field>
            </div>
            <div style={{ borderTop: '1px solid #21262d' }} />
            <div className="grid grid-cols-2 gap-4">
              <ResourceInputs label="CPU"
                req={get(f,'certController.resources.requests.cpu')}    lim={get(f,'certController.resources.limits.cpu')}
                onReqChange={v => set('certController.resources.requests.cpu', v)} onLimChange={v => set('certController.resources.limits.cpu', v)} />
              <ResourceInputs label="Memory"
                req={get(f,'certController.resources.requests.memory')} lim={get(f,'certController.resources.limits.memory')}
                onReqChange={v => set('certController.resources.requests.memory', v)} onLimChange={v => set('certController.resources.limits.memory', v)} />
            </div>
          </Section>

          {/* Default Images */}
          <Section icon={Image} title="Default Images" accent="#d29922">
            <div className="space-y-3">
              {[
                { label: 'MariaDB',           path: 'config.mariadbImage',        repoHint: 'docker-registry1.mariadb.com/library/mariadb' },
                { label: 'Metrics Exporter',  path: 'config.exporterImage',       repoHint: 'prom/mysqld-exporter' },
                { label: 'MaxScale',          path: 'config.maxscaleImage',       repoHint: 'docker-registry2.mariadb.com/mariadb/maxscale' },
              ].map(({ label, path }) => (
                <div key={path} className="grid grid-cols-5 gap-3 items-end">
                  <div className="col-span-3">
                    <Field label={`${label} — Repository`}>
                      <TextInput value={get(f, `${path}.repository`) ?? ''} onChange={v => set(`${path}.repository`, v)} mono />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Tag">
                      <TextInput value={get(f, `${path}.tag`) ?? ''} onChange={v => set(`${path}.tag`, v)} placeholder="latest" mono />
                    </Field>
                  </div>
                </div>
              ))}
              <div>
                <Field label="Default MariaDB Version" hint="Used when no version specified in MariaDB CR">
                  <TextInput value={f.config?.mariadbDefaultVersion ?? ''} onChange={v => set('config.mariadbDefaultVersion', v)} placeholder="11.8" mono />
                </Field>
              </div>
            </div>
          </Section>

          {/* Monitoring */}
          <Section icon={BarChart2} title="Monitoring" accent="#f97316">
            <Toggle label="Operator Metrics" desc="Expose internal controller metrics (requires Prometheus)"
              checked={f.metrics?.enabled ?? false} onChange={v => set('metrics.enabled', v)} />
            {f.metrics?.enabled && (
              <div className="grid grid-cols-2 gap-4 pt-2">
                <Field label="Scrape Interval" hint="How often Prometheus scrapes">
                  <TextInput value={f.metrics?.serviceMonitor?.interval ?? '30s'} onChange={v => set('metrics.serviceMonitor.interval', v)} mono />
                </Field>
                <Field label="Scrape Timeout">
                  <TextInput value={f.metrics?.serviceMonitor?.scrapeTimeout ?? '25s'} onChange={v => set('metrics.serviceMonitor.scrapeTimeout', v)} mono />
                </Field>
              </div>
            )}
            <div style={{ borderTop: '1px solid #21262d' }} />
            <Toggle label="Webhook Metrics" checked={f.webhook?.serviceMonitor?.enabled ?? false}
              onChange={v => set('webhook.serviceMonitor.enabled', v)}
              desc="Expose webhook metrics" />
            <Toggle label="Cert Controller Metrics" checked={f.certController?.serviceMonitor?.enabled ?? false}
              onChange={v => set('certController.serviceMonitor.enabled', v)}
              desc="Expose cert controller metrics" />
          </Section>

        </div>

        {/* Right: YAML preview */}
        <div>
          <YAMLPreview values={yamlValues} original={userValues ?? {}} />
        </div>
      </div>
    </div>
  )
}

// ── helpers ───────────────────────────────────────────────────────────────────

function initForm(all) {
  return {
    logLevel:             all.logLevel             ?? 'INFO',
    clusterName:          all.clusterName           ?? 'cluster.local',
    currentNamespaceOnly: all.currentNamespaceOnly  ?? false,
    revisionHistoryLimit: all.revisionHistoryLimit  ?? 10,
    ha:          { enabled: all.ha?.enabled ?? false, replicas: all.ha?.replicas ?? 3 },
    resources:   all.resources   ?? {},
    metrics: {
      enabled: all.metrics?.enabled ?? false,
      serviceMonitor: {
        interval:      all.metrics?.serviceMonitor?.interval      ?? '30s',
        scrapeTimeout: all.metrics?.serviceMonitor?.scrapeTimeout ?? '25s',
      },
    },
    webhook: {
      enabled: all.webhook?.enabled ?? true,
      port:    all.webhook?.port    ?? 10250,
      ha:      { enabled: all.webhook?.ha?.enabled ?? false, replicas: all.webhook?.ha?.replicas ?? 3 },
      resources: all.webhook?.resources ?? {},
      serviceMonitor: { enabled: all.webhook?.serviceMonitor?.enabled ?? false },
    },
    certController: {
      enabled:               all.certController?.enabled               ?? true,
      caLifetime:            all.certController?.caLifetime            ?? '26280h',
      certLifetime:          all.certController?.certLifetime          ?? '2160h',
      renewBeforePercentage: all.certController?.renewBeforePercentage ?? 33,
      resources:             all.certController?.resources             ?? {},
      serviceMonitor: { enabled: all.certController?.serviceMonitor?.enabled ?? false },
    },
    config: {
      mariadbDefaultVersion: all.config?.mariadbDefaultVersion ?? '11.8',
      mariadbImage:    { repository: all.config?.mariadbImage?.repository    ?? '', tag: all.config?.mariadbImage?.tag    ?? '' },
      exporterImage:   { repository: all.config?.exporterImage?.repository   ?? '', tag: all.config?.exporterImage?.tag   ?? '' },
      maxscaleImage:   { repository: all.config?.maxscaleImage?.repository   ?? '', tag: all.config?.maxscaleImage?.tag   ?? '' },
    },
    crds: { enabled: true },
  }
}

// strip empty strings/objects before sending to helm
function clean(obj) {
  if (typeof obj !== 'object' || obj === null) return obj
  const out = {}
  Object.entries(obj).forEach(([k, v]) => {
    const c = clean(v)
    if (c === '' || c === null || c === undefined) return
    if (typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) return
    out[k] = c
  })
  return out
}

function buildFormValues(f) {
  if (!f) return {}
  return clean(JSON.parse(JSON.stringify(f)))
}
