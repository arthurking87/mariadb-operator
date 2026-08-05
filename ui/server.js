import express from 'express'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execAsync = promisify(exec)
const app = express()
app.use(express.json())

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
    lines.push(`  sidecarContainers:`)
    lines.push(`    - name: pmm-client`)
    lines.push(`      image: ${pmmImage}`)
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
// sees resources that actually belong to it.
app.get('/api/crd/:kind', async (req, res) => {
  const entry = crdEntry(req.params.kind)
  if (!entry) return res.status(400).json({ error: `unknown resource kind: ${req.params.kind}` })
  const { namespace, ref, refField } = req.query
  if (!namespace) return res.status(400).json({ error: 'namespace is required' })
  try {
    const { stdout } = await execFileAsync('kubectl', ['get', entry.plural, '-n', namespace, '-o', 'json'])
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
    const { stdout } = await execAsync(
      `kubectl get mariadb -A -o json`
    )
    const data = JSON.parse(stdout)
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
      }
    })
    res.json({ instances })
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

// Get single instance detail
app.get('/api/instances/:namespace/:name', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const { stdout } = await execAsync(`kubectl get mariadb ${name} -n ${namespace} -o json`)
    const item = JSON.parse(stdout)
    const meta = item.metadata
    const spec = item.spec
    const status = item.status || {}

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
    res.status(500).json({ error: err.message })
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

      return {
        name: p.metadata.name,
        phase: p.status.phase,
        role: roles[p.metadata.name] ?? 'Unknown',
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

// Get services for an instance
app.get('/api/instances/:namespace/:name/services', async (req, res) => {
  const { namespace, name } = req.params
  try {
    const { stdout } = await execAsync(
      `kubectl get svc -n ${namespace} -o json`
    )
    const all = JSON.parse(stdout).items
    const svcs = all.filter(s =>
      s.metadata.name === name ||
      s.metadata.name.startsWith(`${name}-`)
    ).filter(s => s.metadata.name !== `${name}-internal` || true)

    const result = svcs.map(s => ({
      name: s.metadata.name,
      type: s.spec.type,
      clusterIP: s.spec.clusterIP ?? '—',
      ports: s.spec.ports.map(p => ({ port: p.port, protocol: p.protocol, name: p.name })),
    }))
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
