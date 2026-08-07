import express from 'express'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execAsync = promisify(exec)
const app = express()
app.use(express.json())

// ── UI action log ────────────────────────────────────────────────────────────
//
// Local record of mutating requests this UI has actually sent (deploys, deletes,
// switchovers, chaos drills, CRD create/delete, ...) — not to be confused with
// GET /api/events, which shows Kubernetes' own Events for objects the *operator*
// touched. Added after a real incident: an instance disappeared and it took a while to
// work out someone had just clicked "Delete instance" in this UI, because that DELETE
// call leaves no trace of its own (see Ui.md, "my-mariadb-1 消失了"). This UI has no
// login/identity system, so entries can't say *who* — only *what* and *when*, which is
// still enough to answer "did someone actually do this, and when" during a postmortem.
//
// Kept as a capped in-memory ring buffer plus a best-effort append-only file so recent
// history survives a `node server.js` restart (this file has no HMR, see Ui.md's own
// noted limitation, so restarts happen often during dev).
const ACTION_LOG_LIMIT = 200
const ACTION_LOG_PATH = process.env.ACTION_LOG_PATH || '/tmp/mariadb-ui-actions.jsonl'
let actionLog = []
try {
  actionLog = fs.readFileSync(ACTION_LOG_PATH, 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-ACTION_LOG_LIMIT)
} catch {
  // No log file yet (first run) — start empty.
}

function recordAction(entry) {
  actionLog.push(entry)
  if (actionLog.length > ACTION_LOG_LIMIT) actionLog = actionLog.slice(-ACTION_LOG_LIMIT)
  try {
    fs.appendFileSync(ACTION_LOG_PATH, JSON.stringify(entry) + '\n')
  } catch (err) {
    console.error('Failed to persist UI action log entry:', err.message)
  }
}

// Turns (method, path, body) into a one-line human summary. Falls through to a generic
// "METHOD /path" line for anything not explicitly matched, so a new mutating route added
// later still shows up in the log even before someone gets around to describing it here.
function describeAction(method, urlPath, body) {
  const seg = urlPath.split('?')[0].split('/').filter(Boolean) // ['api', 'instances', 'test1', 'test-db-1', ...]
  const b = body || {}

  if (method === 'POST' && urlPath === '/api/deploy') return `Deployed new instance ${b.namespace}/${b.name}`
  if (method === 'POST' && urlPath === '/api/helm/upgrade') return 'Applied Helm upgrade to the operator release'
  if (method === 'POST' && urlPath === '/api/secrets') return `Created Secret "${b.name}" in ${b.namespace}`

  if (seg[0] === 'api' && seg[1] === 'crd') {
    const kind = seg[2]
    if (method === 'POST') return `Created ${kind} "${b.name}" in ${b.namespace}`
    if (method === 'DELETE') return `Deleted ${kind} "${seg[4]}" from ${seg[3]}`
  }

  if (seg[0] === 'api' && seg[1] === 'instances' && seg.length >= 4) {
    const ns = seg[2], name = seg[3], sub = seg[4]
    if (!sub && method === 'DELETE') return `Deleted instance ${ns}/${name}`
    if (sub === 'chaos' && seg[5] === 'delete-pod') return `Chaos drill: deleted pod "${b.podName}" in ${ns}/${name}`
    if (sub === 'restore-drill' && method === 'POST') return `Started restore drill on ${ns}/${name} from backup "${b.backupName}"`
    if (sub === 'restore-drill' && method === 'DELETE') return `Cleaned up restore drill on ${ns}/${name}`
    if (sub === 'image') return `Changed image on ${ns}/${name} to "${b.image}"`
    if (sub === 'storage-size') return `Resized storage on ${ns}/${name} to ${b.size}`
    if (sub === 'storage-class') return `Changed storage class on ${ns}/${name} to "${b.storageClassName}"`
    if (sub === 'service-type') return `Changed service type on ${ns}/${name} to ${b.serviceType}`
    if (sub === 'replicas') return `Scaled ${ns}/${name} to ${b.replicas} replicas`
    if (sub === 'switchover') return `Triggered switchover on ${ns}/${name} to pod index ${b.podIndex}`
    if (sub === 'resources') return `Updated resource requests/limits on ${ns}/${name}`
  }

  return `${method} ${urlPath}`
}

app.use((req, res, next) => {
  if (req.method === 'GET' || req.path === '/api/activity/log') return next()
  const startedAt = Date.now()
  res.on('finish', () => {
    recordAction({
      time: new Date(startedAt).toISOString(),
      method: req.method,
      path: req.path,
      summary: describeAction(req.method, req.path, req.body),
      status: res.statusCode,
      ok: res.statusCode < 400,
    })
  })
  next()
})

app.get('/api/activity/log', (req, res) => {
  res.json({ actions: [...actionLog].reverse() })
})

// Helm release managed by this UI — configurable so the same image works
// regardless of which namespace the operator chart is installed into.
const HELM_RELEASE_NAME = process.env.HELM_RELEASE_NAME || 'mariadb-operator'
const HELM_RELEASE_NAMESPACE = process.env.HELM_RELEASE_NAMESPACE || 'test1'
// Chart sources baked into the image (see Dockerfile); override for local dev.
const HELM_CHART_PATH = process.env.HELM_CHART_PATH
  || path.join(__dirname, 'charts', 'mariadb-operator')

// ── helpers ──────────────────────────────────────────────────────────────────

function buildSecret(form) {
  const literals = [`--from-literal=root-password=${form.rootPassword}`]
  if (form.topology !== 'standalone' && form.replPassword)
    literals.push(`--from-literal=password=${form.replPassword}`)
  if (form.initialDatabase?.trim() && form.initialPassword)
    literals.push(`--from-literal=initial-password=${form.initialPassword}`)
  if (form.metrics && form.metricsUsername?.trim() && form.metricsPassword)
    literals.push(`--from-literal=metrics-password=${form.metricsPassword}`)
  return literals
}

function buildYAML(form) {
  const lines = [
    `apiVersion: k8s.mariadb.com/v1alpha1`,
    `kind: MariaDB`,
    `metadata:`,
    `  name: ${form.name}`,
    `  namespace: ${form.namespace}`,
    `spec:`,
    `  rootPasswordSecretKeyRef:`,
    `    name: ${form.name}`,
    `    key: root-password`,
    `  image: "docker-registry1.mariadb.com/library/mariadb:${form.version}"`,
    `  replicas: ${form.replicas}`,
    `  storage:`,
    `    size: ${form.storage}`,
    `    storageClassName: ${form.storageClass}`,
  ]
  if (form.initialDatabase?.trim()) {
    lines.push(`  username: ${form.initialUsername}`)
    lines.push(`  database: ${form.initialDatabase}`)
    lines.push(`  passwordSecretKeyRef:`)
    lines.push(`    name: ${form.name}`)
    lines.push(`    key: initial-password`)
  }
  if (form.topology === 'replication') {
    lines.push(`  replication:`)
    lines.push(`    enabled: true`)
    lines.push(`    primary:`)
    lines.push(`      autoFailover: ${form.autoFailover}`)
    lines.push(`    replica:`)
    lines.push(`      replPasswordSecretKeyRef:`)
    lines.push(`        name: ${form.name}`)
    lines.push(`        key: password`)
    lines.push(`      connectionRetrySeconds: 10`)
    lines.push(`    gtidStrictMode: true`)
    lines.push(`    semiSyncEnabled: ${form.semiSync}`)
  } else if (form.topology === 'galera') {
    lines.push(`  galera:`)
    lines.push(`    enabled: true`)
  }
  lines.push(`  service:`)
  lines.push(`    type: ${form.serviceType}`)
  lines.push(`  primaryService:`)
  lines.push(`    type: ${form.serviceType}`)
  lines.push(`  secondaryService:`)
  lines.push(`    type: ${form.serviceType}`)
  if (form.cpuRequest || form.memRequest) {
    lines.push(`  resources:`)
    lines.push(`    requests:`)
    if (form.cpuRequest) lines.push(`      cpu: "${form.cpuRequest}"`)
    if (form.memRequest) lines.push(`      memory: "${form.memRequest}"`)
    lines.push(`    limits:`)
    if (form.cpuLimit)   lines.push(`      cpu: "${form.cpuLimit}"`)
    if (form.memLimit)   lines.push(`      memory: "${form.memLimit}"`)
  }
  if (form.tls) {
    lines.push(`  tls:`)
    lines.push(`    enabled: true`)
  }
  if (form.metrics) {
    lines.push(`  metrics:`)
    lines.push(`    enabled: true`)
    if (form.metricsUsername?.trim()) {
      lines.push(`    username: ${form.metricsUsername}`)
      lines.push(`    passwordSecretKeyRef:`)
      lines.push(`      name: ${form.name}`)
      lines.push(`      key: metrics-password`)
    }
  }
  if (form.pmmEnabled) {
    const pmmImage = form.pmmImage?.trim() || 'percona/pmm-client:3'
    // spec.sidecarContainers has no securityContext field, so the pmm-client sidecar
    // always inherits the pod-level securityContext. The operator's default there
    // (runAsUser/runAsGroup/fsGroup = mysql's uid, 999) doesn't match the uid the
    // pmm-client:3 image's own files are owned by (pmm-agent, uid/gid 1002), so the
    // agent fails with "mkdir .../tmp: permission denied" once it actually reaches a
    // live PMM Server. Fix: push the pod-level uid/gid to pmm-agent's (1002) and pin
    // the mariadb container back to 999 via its own container-level securityContext,
    // which does exist on the main container and overrides the pod-level default.
    lines.push(`  podSecurityContext:`)
    lines.push(`    runAsNonRoot: true`)
    lines.push(`    runAsUser: 1002`)
    lines.push(`    runAsGroup: 1002`)
    lines.push(`    fsGroup: 1002`)
    lines.push(`  securityContext:`)
    lines.push(`    runAsUser: 999`)
    lines.push(`    runAsGroup: 999`)
    lines.push(`  volumes:`)
    lines.push(`    - name: pmm-client-storage`)
    lines.push(`      emptyDir: {}`)
    lines.push(`  sidecarContainers:`)
    lines.push(`    - name: pmm-client`)
    lines.push(`      image: ${pmmImage}`)
    lines.push(`      volumeMounts:`)
    lines.push(`        - name: pmm-client-storage`)
    lines.push(`          mountPath: /usr/local/percona/pmm/config`)
    lines.push(`      env:`)
    lines.push(`        - name: PMM_AGENT_SERVER_ADDRESS`)
    lines.push(`          value: "${form.pmmServerAddress}"`)
    lines.push(`        - name: PMM_AGENT_SERVER_USERNAME`)
    lines.push(`          valueFrom:`)
    lines.push(`            secretKeyRef:`)
    lines.push(`              name: ${form.name}-pmm-server`)
    lines.push(`              key: username`)
    lines.push(`        - name: PMM_AGENT_SERVER_PASSWORD`)
    lines.push(`          valueFrom:`)
    lines.push(`            secretKeyRef:`)
    lines.push(`              name: ${form.name}-pmm-server`)
    lines.push(`              key: password`)
    lines.push(`        - name: PMM_AGENT_SERVER_INSECURE_TLS`)
    lines.push(`          value: "${!!form.pmmInsecureTls}"`)
    lines.push(`        - name: PMM_AGENT_CONFIG_FILE`)
    lines.push(`          value: "config/pmm-agent.yaml"`)
    lines.push(`        - name: PMM_AGENT_SETUP`)
    lines.push(`          value: "1"`)
    lines.push(`        - name: PMM_AGENT_SETUP_FORCE`)
    lines.push(`          value: "1"`)
    lines.push(`        - name: PMM_AGENT_SIDECAR`)
    lines.push(`          value: "1"`)
    lines.push(`        - name: PMM_DB_USERNAME`)
    lines.push(`          value: "${form.pmmDbUsername}"`)
    lines.push(`        - name: PMM_DB_PASSWORD`)
    lines.push(`          valueFrom:`)
    lines.push(`            secretKeyRef:`)
    lines.push(`              name: ${form.name}-pmm-db`)
    lines.push(`              key: password`)
    lines.push(`        - name: PMM_AGENT_PRERUN_SCRIPT`)
    lines.push(`          value: "pmm-admin status --wait=10s; pmm-admin add mysql --username=\${PMM_DB_USERNAME} --password=\${PMM_DB_PASSWORD} --host=127.0.0.1 --port=3306 --service-name=${form.name} --query-source=perfschema"`)
  }
  return lines.join('\n')
}

// Records an action performed from the UI as a real Kubernetes Event, so it shows up
// merged with the operator's own reconciler events in the same /api/activity feed —
// no separate storage needed. Best-effort: a failure here must never fail the caller's
// actual operation, so errors are swallowed (and logged).
async function recordUiEvent({ namespace, name, kind = 'MariaDB', reason, message }) {
  const now = new Date().toISOString()
  const yaml = [
    `apiVersion: v1`,
    `kind: Event`,
    `metadata:`,
    `  generateName: mariadb-ui-`,
    `  namespace: ${namespace}`,
    `involvedObject:`,
    `  apiVersion: k8s.mariadb.com/v1alpha1`,
    `  kind: ${kind}`,
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    `reason: ${reason}`,
    `message: ${JSON.stringify(message)}`,
    `type: Normal`,
    `firstTimestamp: "${now}"`,
    `lastTimestamp: "${now}"`,
    `count: 1`,
    `source:`,
    `  component: mariadb-operator-ui`,
  ].join('\n')

  try {
    await new Promise((resolve, reject) => {
      const child = exec(`kubectl create -f -`, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve(stdout)
      })
      child.stdin.write(yaml)
      child.stdin.end()
    })
  } catch (err) {
    console.error('Failed to record UI activity event:', err.message)
  }
}

// ── routes ────────────────────────────────────────────────────────────────────

// ── helm ──────────────────────────────────────────────────────────────────────

app.get('/api/helm/values', async (req, res) => {
  try {
    const [allOut, userOut] = await Promise.all([
      execAsync(`helm get values ${HELM_RELEASE_NAME} -n ${HELM_RELEASE_NAMESPACE} --all -o json`),
      execAsync(`helm get values ${HELM_RELEASE_NAME} -n ${HELM_RELEASE_NAMESPACE} -o json`),
    ])
    res.json({ all: JSON.parse(allOut.stdout), user: JSON.parse(userOut.stdout) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/helm/upgrade', async (req, res) => {
  const values = req.body  // plain JS object → converted to YAML inline
  try {
    const yaml = toHelmYAML(values)
    await new Promise((resolve, reject) => {
      const child = exec(
        `helm upgrade ${HELM_RELEASE_NAME} ${HELM_CHART_PATH} -n ${HELM_RELEASE_NAMESPACE} -f -`,
        (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout)
      )
      child.stdin.write(yaml)
      child.stdin.end()
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function toHelmYAML(obj, indent = 0) {
  const pad = ' '.repeat(indent)
  return Object.entries(obj).map(([k, v]) => {
    if (v === null || v === undefined) return null
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0)
      return `${pad}${k}:\n${toHelmYAML(v, indent + 2)}`
    if (Array.isArray(v))
      return v.length ? `${pad}${k}:\n${v.map(i => `${pad}  - ${JSON.stringify(i)}`).join('\n')}` : null
    return `${pad}${k}: ${JSON.stringify(v)}`
  }).filter(Boolean).join('\n')
}

// ── generic CRD resources (Database/User/Grant/Backup/Restore/PhysicalBackup/       ──
// ── PointInTimeRecovery/SqlJob/Connection/MaxScale/ExternalMariaDB) ─────────────────
//
// All of these are plain k8s.mariadb.com custom resources, so instead of hand-writing
// list/create/delete handlers per kind (11x near-identical code), we validate the kind
// against a whitelist and drive `kubectl` generically. Creates go through `kubectl apply
// -f -` with the YAML piped over stdin (never interpolated into a shell command), and
// list/get/delete use execFile with an argv array (no shell involved at all), since these
// endpoints handle a lot more free-form user input (SQL text, arbitrary names) than the
// rest of this file.
const execFileAsync = promisify(execFile)

const CRD_REGISTRY = {
  database:            { kind: 'Database',            plural: 'databases',             scope: 'instance' },
  user:                 { kind: 'User',                 plural: 'users',                  scope: 'instance' },
  grant:                { kind: 'Grant',                plural: 'grants',                 scope: 'instance' },
  backup:               { kind: 'Backup',               plural: 'backups',                scope: 'instance' },
  restore:              { kind: 'Restore',              plural: 'restores',               scope: 'instance' },
  physicalbackup:       { kind: 'PhysicalBackup',       plural: 'physicalbackups',        scope: 'instance' },
  pointintimerecovery:  { kind: 'PointInTimeRecovery',  plural: 'pointintimerecoveries',  scope: 'namespace' },
  sqljob:                { kind: 'SqlJob',                plural: 'sqljobs',                 scope: 'instance' },
  connection:           { kind: 'Connection',           plural: 'connections',            scope: 'instance' },
  maxscale:             { kind: 'MaxScale',             plural: 'maxscales',              scope: 'namespace' },
  externalmariadb:      { kind: 'ExternalMariaDB',      plural: 'externalmariadbs',       scope: 'namespace' },
}

function crdEntry(kindParam) {
  return CRD_REGISTRY[String(kindParam || '').toLowerCase()]
}

function buildCRYAML(apiKind, metadata, spec) {
  const lines = [
    `apiVersion: k8s.mariadb.com/v1alpha1`,
    `kind: ${apiKind}`,
    `metadata:`,
    `  name: ${JSON.stringify(metadata.name)}`,
    `  namespace: ${JSON.stringify(metadata.namespace)}`,
  ]
  const specYAML = toHelmYAML(spec, 2)
  if (specYAML) lines.push(`spec:`, specYAML)
  return lines.join('\n') + '\n'
}

// List instances of a CRD kind. Instance-scoped kinds are additionally filtered by
// spec.mariaDbRef.name (or spec.physicalBackupRef.name for PointInTimeRecovery) when a
// `mariadb`/`ref` query param is given, so a single MariaDB instance's detail page only
// sees resources that actually belong to it. `namespace` itself is optional — omit it to
// list across every namespace (used by the cross-instance Backups page), same as `kubectl
// get <kind> -A`.
app.get('/api/crd/:kind', async (req, res) => {
  const entry = crdEntry(req.params.kind)
  if (!entry) return res.status(400).json({ error: `unknown resource kind: ${req.params.kind}` })
  const { namespace, ref, refField } = req.query
  try {
    const scopeArgs = namespace ? ['-n', namespace] : ['-A']
    const { stdout } = await execFileAsync('kubectl', ['get', entry.plural, ...scopeArgs, '-o', 'json'])
    let items = JSON.parse(stdout).items
    if (ref && refField) {
      items = items.filter(i => i.spec?.[refField]?.name === ref)
    }
    res.json({
      items: items.map(i => ({
        name: i.metadata.name,
        namespace: i.metadata.namespace,
        creationTimestamp: i.metadata.creationTimestamp,
        spec: i.spec,
        status: i.status,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create a CRD instance. Body: { namespace, name, spec }
app.post('/api/crd/:kind', async (req, res) => {
  const entry = crdEntry(req.params.kind)
  if (!entry) return res.status(400).json({ error: `unknown resource kind: ${req.params.kind}` })
  const { namespace, name, spec } = req.body
  if (!namespace || !name) return res.status(400).json({ error: 'namespace and name are required' })
  try {
    const yaml = buildCRYAML(entry.kind, { name, namespace }, spec || {})
    await new Promise((resolve, reject) => {
      const child = exec(`kubectl apply -f -`, (err, stdout, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve(stdout))
      child.stdin.write(yaml)
      child.stdin.end()
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a CRD instance.
app.delete('/api/crd/:kind/:namespace/:name', async (req, res) => {
  const entry = crdEntry(req.params.kind)
  if (!entry) return res.status(400).json({ error: `unknown resource kind: ${req.params.kind}` })
  const { namespace, name } = req.params
  try {
    await execFileAsync('kubectl', ['delete', entry.plural, name, '-n', namespace, '--ignore-not-found'])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create or update a generic Secret with literal key/value pairs. Shared by the /api/secrets
// route (used by the CRD create forms) and /api/deploy (used by the New Instance wizard's
// optional S3 backup step) so there's one place that knows how to do this safely.
async function applySecret(namespace, name, literals) {
  const args = ['create', 'secret', 'generic', name, '-n', namespace]
  for (const [k, v] of Object.entries(literals)) args.push(`--from-literal=${k}=${v}`)
  const { stdout: dryRunYAML } = await execFileAsync('kubectl', [...args, '--dry-run=client', '-o', 'yaml'])
  await new Promise((resolve, reject) => {
    const child = exec(`kubectl apply -f -`, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout))
    child.stdin.write(dryRunYAML)
    child.stdin.end()
  })
}

// Body: { namespace, name, literals: { key: value } }
app.post('/api/secrets', async (req, res) => {
  const { namespace, name, literals } = req.body
  if (!namespace || !name || !literals || !Object.keys(literals).length)
    return res.status(400).json({ error: 'namespace, name and at least one literal are required' })
  try {
    await applySecret(namespace, name, literals)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// List namespaces
app.get('/api/namespaces', async (req, res) => {
  try {
    const { stdout } = await execAsync('kubectl get namespaces -o json')
    const items = JSON.parse(stdout).items
    const namespaces = items
      .filter(n => n.status.phase === 'Active')
      .map(n => n.metadata.name)
      .sort()
    res.json({ namespaces })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// List StorageClasses actually available in the cluster (e.g. site-specific ones like
// netapp-san-ssd-dc1/dc2/dc3), so the New Instance wizard's Storage Class field isn't stuck
// offering a hardcoded, possibly-wrong list. Cluster-scoped, no namespace filter.
app.get('/api/storageclasses', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('kubectl', ['get', 'storageclass', '-o', 'json'])
    const items = JSON.parse(stdout).items
    const storageClasses = items
      .map(sc => ({
        name: sc.metadata.name,
        isDefault: sc.metadata.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
        provisioner: sc.provisioner,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({ storageClasses })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// List all MariaDB instances across namespaces
app.get('/api/instances', async (req, res) => {
  try {
    // Backup/PhysicalBackup are fetched best-effort alongside the instance list, purely to
    // compute `hasScheduledBackup` per instance (same "any Backup/PhysicalBackup CR owned by
    // this instance with spec.schedule.cron set" check as the Backups page). If either list
    // fails (e.g. one of the CRDs isn't installed), degrade to "unknown" for every instance
    // rather than taking down the whole Instances page over it.
    const [mdbOut, backupOut, physicalBackupOut] = await Promise.all([
      execAsync(`kubectl get mariadb -A -o json`),
      execAsync(`kubectl get backups -A -o json`).catch(() => null),
      execAsync(`kubectl get physicalbackups -A -o json`).catch(() => null),
    ])
    const data = JSON.parse(mdbOut.stdout)

    const scheduledBackupOwners = new Set()
    let backupListOk = true
    for (const out of [backupOut, physicalBackupOut]) {
      if (!out) { backupListOk = false; continue }
      for (const b of JSON.parse(out.stdout).items) {
        if (b.spec?.schedule?.cron && b.spec?.mariaDbRef?.name) {
          scheduledBackupOwners.add(`${b.metadata.namespace}/${b.spec.mariaDbRef.name}`)
        }
      }
    }

    const instances = data.items.map(item => {
      const meta = item.metadata
      const spec = item.spec
      const status = item.status || {}
      const ready = status.conditions?.find(c => c.type === 'Ready')
      const replicas = status.replicas ?? spec.replicas ?? 1

      const topology = spec.replication?.enabled
        ? 'Replication'
        : spec.galera?.enabled
          ? 'Galera'
          : 'Standalone'

      const creationTime = new Date(meta.creationTimestamp)
      const ageMs = Date.now() - creationTime.getTime()
      const ageMin = Math.floor(ageMs / 60000)
      const age = ageMin < 60
        ? `${ageMin}m`
        : ageMin < 1440
          ? `${Math.floor(ageMin / 60)}h`
          : `${Math.floor(ageMin / 1440)}d`

      return {
        name: meta.name,
        namespace: meta.namespace,
        type: topology,
        replicas,
        status: ready?.status === 'True' ? 'Running' : (ready ? 'Not Ready' : 'Pending'),
        statusMessage: ready?.message ?? '',
        primary: status.currentPrimary ?? `${meta.name}-0`,
        version: spec.image?.tag ?? status.defaultVersion ?? '—',
        storage: spec.storage?.size ?? '—',
        age,
        hasScheduledBackup: backupListOk ? scheduledBackupOwners.has(`${meta.namespace}/${meta.name}`) : null,
      }
    })
    res.json({ instances })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Global search: name-substring match across MariaDB instances and every CRD kind in the
// registry, cluster-wide. One `kubectl get <kinds> -A` call (comma-separated resource
// types is a single API round trip) rather than one call per kind. Each hit carries enough
// to navigate straight to it: the owning instance (via spec.mariaDbRef.name, when the kind
// has one) and which CRDs-tab sub-kind to preselect.
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase()
  if (!q) return res.json({ results: [] })
  try {
    const kinds = ['mariadbs', ...Object.values(CRD_REGISTRY).map(e => e.plural)]
    const { stdout } = await execFileAsync('kubectl', ['get', kinds.join(','), '-A', '-o', 'json'])
    const items = JSON.parse(stdout).items ?? []
    const kindToKey = Object.fromEntries(Object.entries(CRD_REGISTRY).map(([key, e]) => [e.kind, key]))

    const results = items
      .filter(i => i.metadata.name.toLowerCase().includes(q))
      .map(i => {
        const kind = i.kind
        const isInstance = kind === 'MariaDB'
        return {
          kind,
          name: i.metadata.name,
          namespace: i.metadata.namespace,
          instanceName: isInstance ? i.metadata.name : (i.spec?.mariaDbRef?.name ?? null),
          crdKind: isInstance ? null : (kindToKey[kind] ?? null),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40)

    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Aggregate CPU/memory/storage requests-limits across every MariaDB instance, grouped by
// namespace. No metrics-server dependency (this cluster doesn't have one) — it's a
// capacity-planning view of what's been *requested*, not live utilization.
function parseCpu(v) {
  if (!v) return 0
  const s = String(v).trim()
  return s.endsWith('m') ? parseFloat(s) / 1000 : parseFloat(s)
}
app.get('/api/capacity', async (req, res) => {
  try {
    const { stdout } = await execAsync(`kubectl get mariadb -A -o json`)
    const items = JSON.parse(stdout).items
    const byNamespace = {}
    const totals = { cpuRequest: 0, cpuLimit: 0, memRequest: 0, memLimit: 0, storage: 0, instances: 0, replicas: 0 }

    for (const item of items) {
      const ns = item.metadata.namespace
      const spec = item.spec
      const replicas = item.status?.replicas ?? spec.replicas ?? 1
      const cpuReq = parseCpu(spec.resources?.requests?.cpu) * replicas
      const cpuLim = parseCpu(spec.resources?.limits?.cpu) * replicas
      const memReq = (parseStorageBytes(spec.resources?.requests?.memory) ?? 0) * replicas
      const memLim = (parseStorageBytes(spec.resources?.limits?.memory) ?? 0) * replicas
      const storage = (parseStorageBytes(spec.storage?.size) ?? 0) * replicas

      if (!byNamespace[ns]) byNamespace[ns] = { namespace: ns, cpuRequest: 0, cpuLimit: 0, memRequest: 0, memLimit: 0, storage: 0, instances: 0, replicas: 0 }
      const bucket = byNamespace[ns]
      bucket.cpuRequest += cpuReq; bucket.cpuLimit += cpuLim
      bucket.memRequest += memReq; bucket.memLimit += memLim
      bucket.storage += storage
      bucket.instances += 1
      bucket.replicas += replicas

      totals.cpuRequest += cpuReq; totals.cpuLimit += cpuLim
      totals.memRequest += memReq; totals.memLimit += memLim
      totals.storage += storage
      totals.instances += 1
      totals.replicas += replicas
    }

    res.json({
      totals,
      namespaces: Object.values(byNamespace).sort((a, b) => b.cpuRequest - a.cpuRequest),
      instances: items.map(item => {
        const spec = item.spec
        const replicas = item.status?.replicas ?? spec.replicas ?? 1
        return {
          name: item.metadata.name,
          namespace: item.metadata.namespace,
          replicas,
          cpuRequest: spec.resources?.requests?.cpu ?? null,
          cpuLimit: spec.resources?.limits?.cpu ?? null,
          memRequest: spec.resources?.requests?.memory ?? null,
          memLimit: spec.resources?.limits?.memory ?? null,
          storage: spec.storage?.size ?? null,
        }
      }),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Deploy a new MariaDB instance
app.post('/api/deploy', async (req, res) => {
  const form = req.body
  const { name, namespace, rootPassword, topology, replPassword } = form

  if (!name || !namespace || !rootPassword)
    return res.status(400).json({ error: 'name, namespace and rootPassword are required' })
  if (topology !== 'standalone' && !replPassword)
    return res.status(400).json({ error: 'replPassword is required for replication/galera' })
  if (form.pmmEnabled && (!form.pmmServerAddress || !form.pmmServerPassword || !form.pmmDbUsername || !form.pmmDbPassword))
    return res.status(400).json({ error: 'pmmServerAddress, pmmServerPassword, pmmDbUsername and pmmDbPassword are required when PMM monitoring is enabled' })

  const steps = []
  try {
    // 1. Ensure namespace exists
    await execAsync(
      `kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`
    )
    steps.push(`Namespace "${namespace}" ready`)

    // 2. Create/update secret
    const literalArgs = buildSecret(form).join(' ')
    await execAsync(
      `kubectl create secret generic ${name} ${literalArgs} -n ${namespace} --dry-run=client -o yaml | kubectl apply -f -`
    )
    steps.push(`Secret "${name}" created`)

    // 2b. Optional Percona PMM monitoring — two more Secrets (PMM Server auth,
    // DB monitoring user) referenced by the sidecarContainers env below. Created via
    // applySecret (execFile, no shell interpolation of the password value) same as the
    // backup S3 credentials further down, rather than folded into the single `literalArgs`
    // string above.
    if (form.pmmEnabled) {
      await applySecret(namespace, `${name}-pmm-server`, { username: form.pmmServerUsername, password: form.pmmServerPassword })
      await applySecret(namespace, `${name}-pmm-db`, { password: form.pmmDbPassword })
      steps.push(`PMM credential Secrets created`)
    }

    // 3. Apply MariaDB manifest via stdin
    const yaml = buildYAML(form)
    await new Promise((resolve, reject) => {
      const child = exec(
        `kubectl apply -f -`,
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message))
          else resolve(stdout)
        }
      )
      child.stdin.write(yaml)
      child.stdin.end()
    })
    steps.push(`MariaDB "${name}" applied`)

    // 4. Optional recurring Backup, created as a separate Backup CR (same mechanism as the
    // Backups tab on the instance detail page) so it shows up there too.
    if (form.backupEnabled) {
      const cron = form.backupPreset === 'custom' ? form.backupCronCustom : form.backupPreset
      const backupName = `${name}-backup`
      const backupSpec = {
        mariaDbRef: { name },
        schedule: { cron },
        compression: form.backupCompression || 'none',
      }
      if (form.backupStorageType === 'S3') {
        const accessKeySecret = `${backupName}-access-key-id`
        const secretKeySecret = `${backupName}-secret-access-key`
        await applySecret(namespace, accessKeySecret, { accessKeyId: form.backupS3AccessKeyId })
        await applySecret(namespace, secretKeySecret, { secretAccessKey: form.backupS3SecretAccessKey })
        steps.push(`S3 credential Secrets created`)
        backupSpec.storage = {
          s3: {
            endpoint: form.backupS3Endpoint,
            bucket: form.backupS3Bucket,
            region: form.backupS3Region || undefined,
            prefix: form.backupS3Prefix || undefined,
            accessKeyIdSecretKeyRef: { name: accessKeySecret, key: 'accessKeyId' },
            secretAccessKeySecretKeyRef: { name: secretKeySecret, key: 'secretAccessKey' },
            tls: form.backupS3Tls ? { enabled: true } : undefined,
          },
        }
      } else {
        backupSpec.storage = { persistentVolumeClaim: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: form.backupStorageSize || '1Gi' } } } }
      }
      const backupYAML = buildCRYAML('Backup', { name: backupName, namespace }, backupSpec)
      await new Promise((resolve, reject) => {
        const child = exec(`kubectl apply -f -`, (err, stdout, stderr) =>
          err ? reject(new Error(stderr || err.message)) : resolve(stdout))
        child.stdin.write(backupYAML)
        child.stdin.end()
      })
      steps.push(`Scheduled Backup "${name}-backup" applied (${cron})`)
    }

    res.json({ ok: true, steps, yaml })
  } catch (err) {
    res.status(500).json({ error: err.message, steps })
  }
})

// Whether the mysqld-exporter Deployment for this instance is actually up, not just
// requested. spec.metrics.enabled=true isn't enough on its own — the operator's
// reconcileMetrics() bails out before ever creating the exporter Deployment if the
// ServiceMonitor CRD (from Prometheus Operator) isn't installed in the cluster, logging
// only a Warning Event that's easy to miss. Found by hitting this exact trap: Config
// Health showed "Monitoring connected" from spec alone while no exporter pod existed.
async function isMetricsExporterReady(namespace, name) {
  try {
    const { stdout } = await execFileAsync('kubectl', [
      'get', 'deployment', `${name}-metrics`, '-n', namespace, '--ignore-not-found', '-o', 'json',
    ])
    if (!stdout.trim()) return false
    const dep = JSON.parse(stdout)
    return (dep.status?.readyReplicas ?? 0) >= 1
  } catch {
    return false
  }
}

// Get single instance detail
app.get('/api/instances/:namespace/:name', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const { stdout } = await execAsync(`kubectl get mariadb ${name} -n ${namespace} -o json`)
    const item = JSON.parse(stdout)
    const meta = item.metadata
    const spec = item.spec
    const status = item.status || {}
    const metricsReady = spec.metrics?.enabled ? await isMetricsExporterReady(namespace, name) : false

    const topology = spec.replication?.enabled ? 'Replication'
      : spec.galera?.enabled ? 'Galera' : 'Standalone'

    const creationTime = new Date(meta.creationTimestamp)
    const ageMs = Date.now() - creationTime.getTime()
    const ageMin = Math.floor(ageMs / 60000)
    const age = ageMin < 60 ? `${ageMin}m`
      : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h`
      : `${Math.floor(ageMin / 1440)}d`

    const conditions = (status.conditions || []).map(c => ({
      type: c.type, status: c.status, message: c.message,
      lastTransition: c.lastTransitionTime,
    }))

    const ready = conditions.find(c => c.type === 'Ready')

    res.json({
      name: meta.name,
      namespace: meta.namespace,
      type: topology,
      replicas: status.replicas ?? spec.replicas ?? 1,
      status: ready?.status === 'True' ? 'Running' : (ready ? 'Not Ready' : 'Pending'),
      statusMessage: ready?.message ?? '',
      primary: status.currentPrimary ?? `${meta.name}-0`,
      image: spec.image ?? '',
      version: (() => { const img = spec.image ?? ''; return img.includes(':') ? img.split(':').pop() : (status.defaultVersion ?? '—') })(),
      storage: spec.storage?.size ?? '—',
      storageClass: spec.storage?.storageClassName ?? '—',
      serviceType: spec.service?.type ?? 'ClusterIP',
      age,
      createdAt: meta.creationTimestamp,
      conditions,
      replication: status.replication ?? null,
      tls: status.tls ?? null,
      tlsEnabled: spec.tls?.enabled ?? false,
      metricsEnabled: spec.metrics?.enabled ?? false,
      metricsReady,
      pmmEnabled: (spec.sidecarContainers ?? []).some(c => c.name === 'pmm-client'),
      pmmServerAddress: (spec.sidecarContainers ?? [])
        .find(c => c.name === 'pmm-client')?.env
        ?.find(e => e.name === 'PMM_AGENT_SERVER_ADDRESS')?.value ?? null,
      autoFailover: spec.replication?.primary?.autoFailover ?? false,
      semiSync: spec.replication?.semiSyncEnabled ?? false,
      resources: {
        cpuRequest: spec.resources?.requests?.cpu    ?? '',
        cpuLimit:   spec.resources?.limits?.cpu      ?? '',
        memRequest: spec.resources?.requests?.memory ?? '',
        memLimit:   spec.resources?.limits?.memory   ?? '',
      },
    })
  } catch (err) {
    // The Resilience tab's restore-drill polls this route to check whether "<name>-drill"
    // exists yet — that's a routine "not found" during normal use, not a server error, so
    // surface it as 404 instead of a noisy 500.
    const status = /notfound/i.test(err.message) ? 404 : 500
    res.status(status).json({ error: err.message })
  }
})

// Get pods for an instance
app.get('/api/instances/:namespace/:name/pods', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const [podsOut, crOut] = await Promise.all([
      execAsync(`kubectl get pods -n ${namespace} -l app.kubernetes.io/instance=${name} -o json`),
      execAsync(`kubectl get mariadb ${name} -n ${namespace} -o json`),
    ])
    const pods = JSON.parse(podsOut.stdout).items
    const crStatus = JSON.parse(crOut.stdout).status || {}
    const roles = crStatus.replication?.roles ?? {}

    const result = pods.map(p => {
      const containers = p.status.containerStatuses ?? []
      const initContainers = p.status.initContainerStatuses ?? []
      const readyCount = containers.filter(c => c.ready).length
      const restarts = containers.reduce((s, c) => s + c.restartCount, 0)
      const creationTime = new Date(p.metadata.creationTimestamp)
      const ageMin = Math.floor((Date.now() - creationTime.getTime()) / 60000)
      const age = ageMin < 60 ? `${ageMin}m` : ageMin < 1440 ? `${Math.floor(ageMin / 60)}h` : `${Math.floor(ageMin / 1440)}d`
      // Galera has no per-pod status.replication.roles map (that's a Replication-only
      // status field), so fall back to comparing against currentPrimary — good enough to
      // tell "primary" from "member" for a Galera cluster even without real wsrep state.
      const role = roles[p.metadata.name]
        ?? (p.metadata.name === crStatus.currentPrimary ? 'Primary' : (crStatus.currentPrimary ? 'Member' : 'Unknown'))

      return {
        name: p.metadata.name,
        phase: p.status.phase,
        role,
        ready: `${readyCount}/${containers.length}`,
        restarts,
        age,
        podIP: p.status.podIP ?? '—',
        node: p.spec.nodeName ?? '—',
        containers: containers.map(c => ({
          name: c.name, ready: c.ready, restartCount: c.restartCount,
          image: c.image,
        })),
      }
    })
    res.json({ pods: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Logs for a single container in a pod belonging to this instance. Scoped to
// `app.kubernetes.io/instance=<name>` pods only, same guard as the chaos delete-pod route
// — podName/container can't be used to read logs from anything outside this instance.
// Capped tailLines (default 200, max 2000) since this is meant for "what's going on right
// now", not a full-history log export, and to keep the response size sane.
app.get('/api/instances/:namespace/:name/pods/:podName/logs', async (req, res) => {
  const { namespace, name, podName } = req.params
  const container = req.query.container
  const tailLines = Math.min(Math.max(Number(req.query.tailLines) || 200, 1), 2000)
  if (!container) return res.status(400).json({ error: 'container query param is required' })
  try {
    const { stdout } = await execFileAsync('kubectl', [
      'get', 'pods', '-n', namespace, '-l', `app.kubernetes.io/instance=${name}`, '-o', 'jsonpath={.items[*].metadata.name}',
    ])
    const validPods = stdout.trim().split(/\s+/).filter(Boolean)
    if (!validPods.includes(podName)) {
      return res.status(400).json({ error: `${podName} is not a pod of instance ${name}` })
    }
    const { stdout: logs } = await execFileAsync('kubectl', [
      'logs', podName, '-n', namespace, '-c', container, '--tail', String(tailLines), '--timestamps',
    ], { maxBuffer: 10 * 1024 * 1024 })
    res.json({ logs })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Fetches and base64-decodes a single key out of a k8s Secret.
async function getSecretValue(namespace, secretName, key) {
  const { stdout } = await execFileAsync('kubectl', [
    'get', 'secret', secretName, '-n', namespace, '-o', `jsonpath={.data.${key}}`,
  ])
  return Buffer.from(stdout.trim(), 'base64').toString('utf8')
}

// Structural (not data) schema fingerprint: one row of table_schema.table_name:col-type
// per table, concatenated and hashed, so two pods with identical schemas produce the same
// MD5 regardless of table order. System schemas are excluded since those are expected to
// differ from operator/MariaDB-version internals, not app schema drift.
const SCHEMA_HASH_SQL = `SELECT MD5(GROUP_CONCAT(sig ORDER BY sig SEPARATOR '|')) AS h, COUNT(*) AS c FROM ` +
  `(SELECT CONCAT(table_schema,'.',table_name,':',COALESCE(GROUP_CONCAT(column_name,'-',column_type ORDER BY ordinal_position SEPARATOR ','),'')) AS sig ` +
  `FROM information_schema.columns WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys') ` +
  `GROUP BY table_schema, table_name) t;`

// Schema consistency check (Replication tab widget): verifies every running pod reports the
// same MariaDB version and the same schema-structure hash — same idea as VTAdmin's schema
// tracking. Run on-demand (not auto-refreshed) since each pod needs its own `kubectl exec`
// round trip (~1s+), unlike the rest of this API which reads cheaply from the k8s API server.
app.get('/api/instances/:namespace/:name/schema-check', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const { stdout: crOut } = await execFileAsync('kubectl', ['get', 'mariadb', name, '-n', namespace, '-o', 'json'])
    const cr = JSON.parse(crOut)
    const rootRef = cr.spec?.rootPasswordSecretKeyRef
    if (!rootRef?.name || !rootRef?.key) {
      return res.status(500).json({ error: 'Could not resolve spec.rootPasswordSecretKeyRef on this instance.' })
    }
    const rootPassword = await getSecretValue(namespace, rootRef.name, rootRef.key)

    const { stdout: podsOut } = await execFileAsync('kubectl', [
      'get', 'pods', '-n', namespace, '-l', `app.kubernetes.io/instance=${name}`, '-o', 'json',
    ])
    const pods = JSON.parse(podsOut).items
      .filter(p => p.status?.phase === 'Running')
      .map(p => p.metadata.name)
      .sort()

    if (pods.length === 0) {
      return res.json({ pods: [], schemaConsistent: true, versionConsistent: true, referencePod: null })
    }

    async function checkPod(pod) {
      try {
        const [versionRes, hashRes] = await Promise.all([
          execFileAsync('kubectl', [
            'exec', pod, '-n', namespace, '-c', 'mariadb', '--',
            'mariadb', '-uroot', `-p${rootPassword}`, '-N', '-B', '-e', 'SELECT VERSION();',
          ], { timeout: 15000 }),
          execFileAsync('kubectl', [
            'exec', pod, '-n', namespace, '-c', 'mariadb', '--',
            'mariadb', '-uroot', `-p${rootPassword}`, '-N', '-B', '-e', SCHEMA_HASH_SQL,
          ], { timeout: 15000 }),
        ])
        const version = versionRes.stdout.trim()
        const [hash, count] = hashRes.stdout.trim().split('\t')
        return { pod, version, schemaHash: hash === 'NULL' ? null : hash, tableCount: Number(count) || 0, error: null }
      } catch (err) {
        // Trim to the first line — kubectl/mariadb-client errors can be multi-line and the
        // rest is rarely useful in a one-line-per-pod UI table.
        return { pod, version: null, schemaHash: null, tableCount: null, error: err.message.split('\n')[0] }
      }
    }

    const results = await Promise.all(pods.map(checkPod))
    const ok = results.filter(r => !r.error)
    const referencePod = ok[0]?.pod ?? null
    const referenceHash = ok[0]?.schemaHash ?? null
    const referenceVersion = ok[0]?.version ?? null

    res.json({
      pods: results,
      referencePod,
      schemaConsistent: ok.every(r => r.schemaHash === referenceHash),
      versionConsistent: ok.every(r => r.version === referenceVersion),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Chaos-test hook for the Resilience tab: delete a single pod belonging to this
// instance so the user can watch the operator's failover/self-healing happen live.
// Scoped to `app.kubernetes.io/instance=<name>` pods only — the podName param can't be
// used to delete anything outside this instance's own StatefulSet.
app.post('/api/instances/:namespace/:name/chaos/delete-pod', async (req, res) => {
  const { namespace, name } = req.params
  const { podName } = req.body
  if (!podName) return res.status(400).json({ error: 'podName is required' })
  try {
    const { stdout } = await execFileAsync('kubectl', [
      'get', 'pods', '-n', namespace, '-l', `app.kubernetes.io/instance=${name}`, '-o', 'jsonpath={.items[*].metadata.name}',
    ])
    const validPods = stdout.trim().split(/\s+/).filter(Boolean)
    if (!validPods.includes(podName)) {
      return res.status(400).json({ error: `${podName} is not a pod of instance ${name}` })
    }
    await execFileAsync('kubectl', ['delete', 'pod', podName, '-n', namespace])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Restore drill: spin up a throwaway MariaDB instance bootstrapped from an existing
// Backup CR (spec.bootstrapFrom.backupRef), so a user can prove a backup is actually
// restorable without touching the real instance. Drill instance is fixed-named
// "<name>-drill" (one at a time per instance) and lives in the same namespace, since
// bootstrapFrom.backupRef has no cross-namespace field. Teardown is a plain
// DELETE /api/instances/:namespace/:drillName, reusing the existing generic route.
app.post('/api/instances/:namespace/:name/restore-drill', async (req, res) => {
  const { namespace, name } = req.params
  const { backupName } = req.body
  if (!backupName) return res.status(400).json({ error: 'backupName is required' })
  const drillName = `${name}-drill`
  try {
    const { stdout: existing } = await execFileAsync('kubectl', [
      'get', 'mariadb', drillName, '-n', namespace, '--ignore-not-found', '-o', 'name',
    ])
    if (existing.trim()) {
      return res.status(409).json({ error: `A drill instance "${drillName}" already exists — delete it before starting a new drill.` })
    }

    // Reuse the SOURCE instance's own rootPasswordSecretKeyRef instead of generating a
    // fresh one. A logical (mysqldump) backup restore brings back the source's real
    // mysql.user table — including its root password hash — into the drill instance's
    // database, so the operator's post-restore healthcheck must authenticate with that
    // same password, not a newly generated one. Found by actually running a drill: the
    // pod crash-looped on "Access denied for user 'root'@'localhost'" until this got fixed.
    const { stdout: srcOut } = await execFileAsync('kubectl', ['get', 'mariadb', name, '-n', namespace, '-o', 'json'])
    const srcRootRef = JSON.parse(srcOut).spec?.rootPasswordSecretKeyRef
    if (!srcRootRef?.name || !srcRootRef?.key) {
      return res.status(500).json({ error: `Could not resolve rootPasswordSecretKeyRef on source instance "${name}".` })
    }

    const yaml = [
      `apiVersion: k8s.mariadb.com/v1alpha1`,
      `kind: MariaDB`,
      `metadata:`,
      `  name: ${drillName}`,
      `  namespace: ${namespace}`,
      `  labels:`,
      `    app.kubernetes.io/managed-by: mariadb-ui-drill`,
      `    mariadb-ui/drill-source: ${name}`,
      `spec:`,
      `  rootPasswordSecretKeyRef:`,
      `    name: ${srcRootRef.name}`,
      `    key: ${srcRootRef.key}`,
      `  image: "docker-registry1.mariadb.com/library/mariadb:11.8.5"`,
      `  replicas: 1`,
      `  storage:`,
      `    size: 1Gi`,
      `  service:`,
      `    type: ClusterIP`,
      `  primaryService:`,
      `    type: ClusterIP`,
      `  secondaryService:`,
      `    type: ClusterIP`,
      `  bootstrapFrom:`,
      `    backupRef:`,
      `      name: ${backupName}`,
    ].join('\n') + '\n'

    await new Promise((resolve, reject) => {
      const child = exec(`kubectl apply -f -`, (err, stdout, stderr) =>
        err ? reject(new Error(stderr || err.message)) : resolve(stdout))
      child.stdin.write(yaml)
      child.stdin.end()
    })
    res.json({ ok: true, drillName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Tear down a restore drill: delete the MariaDB CR *and* its PVC. Unlike the generic
// instance-delete route (which deliberately leaves PVCs behind — that's the right default
// for a real instance, see the Dashboard delete modal), a drill instance is throwaway
// scratch data with a fixed, reused name ("<name>-drill"). Found by hand: leaving the PVC
// behind meant a second drill run silently reused the first run's already-restored volume
// instead of actually re-restoring from whichever backup was picked the second time —
// same symptom as a fresh restore, but the data underneath was stale.
app.delete('/api/instances/:namespace/:name/restore-drill', async (req, res) => {
  const { namespace, name } = req.params
  const drillName = `${name}-drill`
  try {
    await execFileAsync('kubectl', ['delete', 'mariadb', drillName, '-n', namespace, '--ignore-not-found', '--wait=true', '--timeout=60s'])
    await execFileAsync('kubectl', ['delete', 'pvc', '-n', namespace, '-l', `app.kubernetes.io/instance=${drillName}`, '--ignore-not-found'])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get services for an instance
app.get('/api/instances/:namespace/:name/services', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const [svcOut, sliceOut] = await Promise.all([
      execAsync(`kubectl get svc -n ${namespace} -o json`),
      // EndpointSlice, not the legacy v1 Endpoints API (deprecated since k8s 1.33) — some of
      // this operator's Services (e.g. "<name>-secondary") are selector-less and have their
      // EndpointSlice hand-managed by the operator itself instead of the built-in k8s
      // endpoint-slice-controller, so `kubectl get endpoints` would show nothing for them
      // even though they're correctly routing traffic. Found by hitting exactly this
      // confusion while debugging live: an operator-managed EndpointSlice existed and was
      // fully populated, but the legacy Endpoints object for that Service didn't.
      execAsync(`kubectl get endpointslices -n ${namespace} -o json`),
    ])
    const all = JSON.parse(svcOut.stdout).items
    const svcs = all.filter(s =>
      s.metadata.name === name ||
      s.metadata.name.startsWith(`${name}-`)
    ).filter(s => s.metadata.name !== `${name}-internal` || true)

    const slices = JSON.parse(sliceOut.stdout).items

    const result = svcs.map(s => {
      const matching = slices.filter(sl => sl.metadata.labels?.['kubernetes.io/service-name'] === s.metadata.name)
      const endpoints = matching.flatMap(sl => sl.endpoints ?? [])
      return {
        name: s.metadata.name,
        type: s.spec.type,
        clusterIP: s.spec.clusterIP ?? '—',
        ports: s.spec.ports.map(p => ({ port: p.port, protocol: p.protocol, name: p.name })),
        endpointsTotal: endpoints.length,
        endpointsReady: endpoints.filter(e => e.conditions?.ready !== false).length,
      }
    })
    res.json({ services: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get recent events for an instance
app.get('/api/instances/:namespace/:name/events', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const { stdout } = await execAsync(
      `kubectl get events -n ${namespace} --sort-by='.lastTimestamp' -o json`
    )
    const allEvents = JSON.parse(stdout).items
    const events = allEvents
      .filter(e => e.involvedObject.name.startsWith(name))
      .slice(-20)
      .reverse()
      .map(e => ({
        type: e.type,
        reason: e.reason,
        object: e.involvedObject.name,
        message: e.message,
        count: e.count,
        lastTime: e.lastTimestamp,
      }))
    res.json({ events })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get recent events across all MariaDB instances, in every namespace (used by the
// Activity page). Scoping mirrors the per-instance endpoint above (name-prefix match
// against involvedObject.name) but applied to every known instance, so it only surfaces
// events actually related to a MariaDB CR or the Pods/StatefulSets/Jobs it owns —
// not unrelated cluster noise.
app.get('/api/events', async (req, res) => {
  try {
    const [instancesOut, eventsOut] = await Promise.all([
      execAsync(`kubectl get mariadb -A -o json`),
      execAsync(`kubectl get events -A --sort-by='.lastTimestamp' -o json`),
    ])
    const instances = JSON.parse(instancesOut.stdout).items.map(i => ({
      name: i.metadata.name,
      namespace: i.metadata.namespace,
    }))
    const allEvents = JSON.parse(eventsOut.stdout).items
    const events = allEvents
      .filter(e => instances.some(i => i.namespace === e.metadata.namespace && e.involvedObject.name.startsWith(i.name)))
      .slice(-50)
      .reverse()
      .map(e => ({
        type: e.type,
        reason: e.reason,
        namespace: e.metadata.namespace,
        object: e.involvedObject.name,
        kind: e.involvedObject.kind,
        message: e.message,
        count: e.count,
        lastTime: e.lastTimestamp,
      }))
    res.json({ events })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Read-only connection info for the Settings page: which Helm release/namespace this UI
// is wired to manage, and which kubeconfig context the backend is using. No mutation.
app.get('/api/connection', async (req, res) => {
  try {
    const { stdout } = await execAsync('kubectl config current-context').catch(() => ({ stdout: '' }))
    res.json({
      context: stdout.trim() || '—',
      releaseName: HELM_RELEASE_NAME,
      releaseNamespace: HELM_RELEASE_NAMESPACE,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Storage size comparison helper (returns bytes as float)
function parseStorageBytes(size) {
  const m = String(size).trim().match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|K|M|G|T)?$/i)
  if (!m) return null
  const n = parseFloat(m[1])
  const table = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12, ki: 1024, mi: 1048576, gi: 1073741824, ti: 1099511627776 }
  return n * (table[(m[2] ?? '').toLowerCase()] ?? 1)
}

// Patch image (version) for an instance
app.patch('/api/instances/:namespace/:name/image', async (req, res) => {
  const { namespace, name } = req.params
  const { image } = req.body
  if (!image) return res.status(400).json({ error: 'image is required' })
  try {
    await execAsync(
      `kubectl patch mariadb ${name} -n ${namespace} --type=merge -p '${JSON.stringify({ spec: { image } })}'`
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Patch storage size (increase only)
app.patch('/api/instances/:namespace/:name/storage-size', async (req, res) => {
  const { namespace, name } = req.params
  const { size } = req.body
  if (!size) return res.status(400).json({ error: 'size is required' })
  try {
    const { stdout } = await execAsync(`kubectl get mariadb ${name} -n ${namespace} -o json`)
    const current = JSON.parse(stdout).spec?.storage?.size ?? '0'
    const currentBytes = parseStorageBytes(current)
    const newBytes = parseStorageBytes(size)
    if (newBytes === null) return res.status(400).json({ error: `Invalid size format: ${size}` })
    if (currentBytes !== null && newBytes <= currentBytes)
      return res.status(400).json({ error: `New size (${size}) must be larger than current size (${current})` })
    await execAsync(
      `kubectl patch mariadb ${name} -n ${namespace} --type=merge -p '${JSON.stringify({ spec: { storage: { size } } })}'`
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.stderr || err.message })
  }
})

// Patch storage class
app.patch('/api/instances/:namespace/:name/storage-class', async (req, res) => {
  const { namespace, name } = req.params
  const { storageClassName } = req.body
  if (!storageClassName) return res.status(400).json({ error: 'storageClassName is required' })
  try {
    await execAsync(
      `kubectl patch mariadb ${name} -n ${namespace} --type=merge -p '${JSON.stringify({ spec: { storage: { storageClassName } } })}'`
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Patch service type (applies to service, primaryService, secondaryService)
app.patch('/api/instances/:namespace/:name/service-type', async (req, res) => {
  const { namespace, name } = req.params
  const { serviceType } = req.body
  const allowed = ['ClusterIP', 'NodePort', 'LoadBalancer']
  if (!allowed.includes(serviceType)) return res.status(400).json({ error: `serviceType must be one of: ${allowed.join(', ')}` })
  try {
    const patch = { spec: { service: { type: serviceType }, primaryService: { type: serviceType }, secondaryService: { type: serviceType } } }
    await execAsync(
      `kubectl patch mariadb ${name} -n ${namespace} --type=merge -p '${JSON.stringify(patch)}'`
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Patch replicas for an instance
app.patch('/api/instances/:namespace/:name/replicas', async (req, res) => {
  const { namespace, name } = req.params
  const { replicas } = req.body
  if (!replicas || replicas < 1) return res.status(400).json({ error: 'replicas must be >= 1' })
  try {
    await execAsync(
      `kubectl patch mariadb ${name} -n ${namespace} --type=merge -p '${JSON.stringify({ spec: { replicas } })}'`
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Planned switchover: set spec.replication.primary.podIndex (or spec.galera.primary.podIndex
// for Galera) to a different pod. This is the operator's own documented manual-switchover
// mechanism (`kubectl explain mariadb.spec.replication.primary.podIndex` — "The user may
// change this field to perform a manual switchover"), not a chaos delete-pod hack: the
// operator runs a graceful multi-phase handover (read lock, read_only, wait for catch-up,
// promote) and reports it via the PrimarySwitched condition.
app.patch('/api/instances/:namespace/:name/switchover', async (req, res) => {
  const { namespace, name } = req.params
  const { podIndex } = req.body
  if (podIndex === undefined || podIndex === null) return res.status(400).json({ error: 'podIndex is required' })
  try {
    const { stdout } = await execFileAsync('kubectl', ['get', 'mariadb', name, '-n', namespace, '-o', 'json'])
    const spec = JSON.parse(stdout).spec
    const field = spec.replication ? 'replication' : spec.galera ? 'galera' : null
    if (!field) return res.status(400).json({ error: `"${name}" is Standalone — there is no primary to switch over` })

    const patch = JSON.stringify({ spec: { [field]: { primary: { podIndex: Number(podIndex) } } } })
    await execFileAsync('kubectl', ['patch', 'mariadb', name, '-n', namespace, '--type=merge', '-p', patch])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Patch resources (cpu/memory) for an instance
app.patch('/api/instances/:namespace/:name/resources', async (req, res) => {
  const { namespace, name } = req.params
  const { cpuRequest, cpuLimit, memRequest, memLimit } = req.body
  const patch = {
    spec: {
      resources: {
        requests: { cpu: cpuRequest || undefined, memory: memRequest || undefined },
        limits:   { cpu: cpuLimit   || undefined, memory: memLimit   || undefined },
      },
    },
  }
  // remove undefined keys
  if (!patch.spec.resources.requests.cpu)    delete patch.spec.resources.requests.cpu
  if (!patch.spec.resources.requests.memory) delete patch.spec.resources.requests.memory
  if (!patch.spec.resources.limits.cpu)      delete patch.spec.resources.limits.cpu
  if (!patch.spec.resources.limits.memory)   delete patch.spec.resources.limits.memory
  try {
    await execAsync(
      `kubectl patch mariadb ${name} -n ${namespace} --type=merge -p '${JSON.stringify(patch)}'`
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a MariaDB instance
app.delete('/api/instances/:namespace/:name', async (req, res) => {
  const { namespace, name } = req.params
  try {
    await execAsync(`kubectl delete mariadb ${name} -n ${namespace}`)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Serve the built frontend (vite build → dist/) so a single container/Pod
// can expose both the API and the UI on one port. No-op in local dev, where
// the Vite dev server (port 5173) serves the UI instead and dist/ is absent.
const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`API server listening on http://localhost:${PORT}`))
