import express from 'express'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const app = express()
app.use(express.json())

// ── helpers ──────────────────────────────────────────────────────────────────

function buildSecret(form) {
  const literals = [`--from-literal=root-password=${form.rootPassword}`]
  if (form.topology !== 'standalone' && form.replPassword)
    literals.push(`--from-literal=password=${form.replPassword}`)
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
  }
  return lines.join('\n')
}

// ── routes ────────────────────────────────────────────────────────────────────

// ── helm ──────────────────────────────────────────────────────────────────────

app.get('/api/helm/values', async (req, res) => {
  try {
    const [allOut, userOut] = await Promise.all([
      execAsync('helm get values mariadb-operator -n test1 --all -o json'),
      execAsync('helm get values mariadb-operator -n test1 -o json'),
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
        `helm upgrade mariadb-operator /home/kasm-user/Downloads/mariadb-operator/deploy/charts/mariadb-operator -n test1 -f -`,
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
      version: spec.image?.tag ?? status.defaultVersion ?? '—',
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

const PORT = 3001
app.listen(PORT, () => console.log(`API server listening on http://localhost:${PORT}`))
