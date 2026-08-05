// Declarative schema for every k8s.mariadb.com CRD the UI can list/create, driving the
// generic ResourceTab/CreateResourceModal components (src/components/crd/). Adding a new
// CRD to the UI means adding one entry here, not writing a new page from scratch.
//
// Field types understood by CreateResourceModal:
//   text | number | boolean | select | multiselect | textarea | password | ref-select
// `password` fields create a Secret via POST /api/secrets and wire a *SecretKeyRef into
// the CR spec instead of writing the value straight into spec (never store plaintext in
// the CR itself, matching how every one of these CRDs is designed to take a secret ref).
// `ref-select` fields fetch another CRD kind's list (scoped to the same instance) and let
// the user pick an existing resource by name (e.g. Restore -> which Backup).

export const PRIVILEGE_OPTIONS = [
  'ALL PRIVILEGES', 'SELECT', 'INSERT', 'UPDATE', 'DELETE',
  'CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES', 'GRANT OPTION',
]

// Shared field set for the "S3 (MinIO / S3-compatible)" storage option on Backup and
// PhysicalBackup — both CRDs have the exact same spec.storage.s3 shape. Fields are only
// shown (and only required) when the schema's own `storageType` field is set to 'S3',
// via `showIf`.
const isS3 = v => v.storageType === 'S3'
function s3Fields() {
  return [
    { key: 's3Endpoint', label: 'S3 Endpoint', type: 'text', required: true, showIf: isS3, placeholder: 'minio.example.com:9000', help: 'Host and port, no scheme — works with MinIO or any S3-compatible endpoint.' },
    { key: 's3Bucket', label: 'Bucket', type: 'text', required: true, showIf: isS3 },
    { key: 's3Region', label: 'Region (optional)', type: 'text', showIf: isS3 },
    { key: 's3Prefix', label: 'Prefix (optional)', type: 'text', showIf: isS3, placeholder: 'mariadb/backups' },
    { key: 's3AccessKeyId', label: 'Access Key ID', type: 'password', required: true, showIf: isS3, secretKey: 'accessKeyId', specField: 'storage.s3.accessKeyIdSecretKeyRef' },
    { key: 's3SecretAccessKey', label: 'Secret Access Key', type: 'password', required: true, showIf: isS3, secretKey: 'secretAccessKey', specField: 'storage.s3.secretAccessKeySecretKeyRef' },
    { key: 's3Tls', label: 'Use TLS', type: 'boolean', default: false, showIf: isS3 },
  ]
}
// Builds spec.storage.s3 from those fields' values — used by buildSpec, not genericBuildSpec,
// since the surrounding storage object also needs the persistentVolumeClaim/volumeSnapshot
// branches alongside it.
function s3StorageSpec(values, ctx) {
  return {
    endpoint: values.s3Endpoint,
    bucket: values.s3Bucket,
    region: values.s3Region || undefined,
    prefix: values.s3Prefix || undefined,
    accessKeyIdSecretKeyRef: { name: ctx.secretNames.s3AccessKeyId, key: 'accessKeyId' },
    secretAccessKeySecretKeyRef: { name: ctx.secretNames.s3SecretAccessKey, key: 'secretAccessKey' },
    tls: values.s3Tls ? { enabled: true } : undefined,
  }
}

export const CRD_SCHEMAS = {
  database: {
    kind: 'database', apiKind: 'Database', label: 'Database', pluralLabel: 'Databases',
    icon: 'HardDrive', accent: '#58a6ff', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, help: 'Also used as the logical database name unless overridden below.' },
      { key: 'characterSet', label: 'Character set', type: 'text', default: 'utf8' },
      { key: 'collate', label: 'Collate', type: 'text', default: 'utf8_general_ci' },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.characterSet', label: 'Character set' },
      { key: 'spec.collate', label: 'Collate' },
      { key: 'status', label: 'Status' },
    ],
  },

  user: {
    kind: 'user', apiKind: 'User', label: 'User', pluralLabel: 'Users',
    icon: 'UserPlus', accent: '#3fb950', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', secretKey: 'password', specField: 'passwordSecretKeyRef', required: true },
      { key: 'maxUserConnections', label: 'Max connections', type: 'number', default: 10 },
      { key: 'host', label: 'Host', type: 'text', default: '%', help: "'%' allows connections from any host." },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.host', label: 'Host' },
      { key: 'spec.maxUserConnections', label: 'Max conns' },
      { key: 'status', label: 'Status' },
    ],
  },

  grant: {
    kind: 'grant', apiKind: 'Grant', label: 'Grant', pluralLabel: 'Grants',
    icon: 'ShieldCheck', accent: '#bc8cff', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true, help: 'Must match an existing User (or the instance root user).' },
      { key: 'privileges', label: 'Privileges', type: 'multiselect', options: PRIVILEGE_OPTIONS, required: true },
      { key: 'database', label: 'Database', type: 'text', default: '*' },
      { key: 'table', label: 'Table', type: 'text', default: '*' },
      { key: 'grantOption', label: 'With grant option', type: 'boolean', default: false },
      { key: 'host', label: 'Host', type: 'text', default: '%' },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.username', label: 'Username' },
      { key: 'spec.database', label: 'Database' },
      { key: 'spec.privileges', label: 'Privileges', render: v => Array.isArray(v) ? v.join(', ') : v },
      { key: 'status', label: 'Status' },
    ],
  },

  backup: {
    kind: 'backup', apiKind: 'Backup', label: 'Backup', pluralLabel: 'Backups',
    icon: 'Archive', accent: '#f97316', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'storageType', label: 'Storage destination', type: 'select', options: ['PersistentVolumeClaim', 'S3'], default: 'PersistentVolumeClaim', help: 'PVC keeps the backup on cluster storage. S3 works with MinIO or any S3-compatible endpoint.' },
      { key: 'storageSize', label: 'Storage size', type: 'text', default: '1Gi', showIf: v => v.storageType === 'PersistentVolumeClaim' },
      ...s3Fields(),
      { key: 'compression', label: 'Compression', type: 'select', options: ['none', 'bzip2', 'gzip'], default: 'none' },
      { key: 'cron', label: 'Recurring schedule (cron, optional)', type: 'text', placeholder: 'e.g. 0 3 * * * for daily at 03:00', help: 'Leave blank for a one-off backup that runs immediately.' },
    ],
    buildSpec: (values, ctx) => {
      const spec = {
        mariaDbRef: { name: '__INSTANCE__' },
        compression: values.compression,
        storage: isS3(values)
          ? { s3: s3StorageSpec(values, ctx) }
          : { persistentVolumeClaim: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: values.storageSize } } } },
      }
      if (values.cron?.trim()) spec.schedule = { cron: values.cron.trim() }
      return spec
    },
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.storage', label: 'Destination', render: (_v, item) => storageDestination(_v, item) },
      { key: 'spec.schedule.cron', label: 'Schedule', render: v => v || 'One-off' },
      { key: 'status', label: 'Status' },
      { key: 'creationTimestamp', label: 'Created', render: relTime },
    ],
  },

  restore: {
    kind: 'restore', apiKind: 'Restore', label: 'Restore', pluralLabel: 'Restores',
    icon: 'RotateCcw', accent: '#d29922', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'backupRef', label: 'Backup to restore from', type: 'ref-select', refKind: 'backup', required: true, specField: 'backupRef.name' },
      { key: 'database', label: 'Database (optional)', type: 'text', help: 'Leave blank to restore every database in the backup.' },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.backupRef.name', label: 'From backup' },
      { key: 'status', label: 'Status' },
      { key: 'creationTimestamp', label: 'Created', render: relTime },
    ],
  },

  physicalbackup: {
    kind: 'physicalbackup', apiKind: 'PhysicalBackup', label: 'Physical Backup', pluralLabel: 'Physical Backups',
    icon: 'Archive', accent: '#f85149', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'target', label: 'Target', type: 'select', options: ['Replica', 'PreferReplica'], default: 'Replica', help: 'Replica requires a ready replica Pod to exist; PreferReplica falls back to the primary if none is available.' },
      { key: 'storageType', label: 'Storage destination', type: 'select', options: ['PersistentVolumeClaim', 'S3', 'VolumeSnapshot'], default: 'PersistentVolumeClaim', help: 'PVC keeps the backup on cluster storage. S3 works with MinIO or any S3-compatible endpoint. VolumeSnapshot uses your CSI driver’s native snapshot support instead of copying data out.' },
      { key: 'storageSize', label: 'Storage size', type: 'text', default: '1Gi', showIf: v => v.storageType === 'PersistentVolumeClaim' },
      ...s3Fields(),
      { key: 'volumeSnapshotClassName', label: 'VolumeSnapshotClass', type: 'text', required: true, showIf: v => v.storageType === 'VolumeSnapshot', placeholder: 'csi-hostpath-snapclass', help: 'Must already exist in the cluster (kubectl get volumesnapshotclass).' },
      { key: 'compression', label: 'Compression', type: 'select', options: ['none', 'bzip2', 'gzip'], default: 'none', showIf: v => v.storageType !== 'VolumeSnapshot', help: 'Not applicable to VolumeSnapshot — snapshots are stored uncompressed by the CSI driver.' },
      { key: 'cron', label: 'Recurring schedule (cron, optional)', type: 'text', placeholder: 'e.g. 0 3 * * * for daily at 03:00', help: 'Leave blank for a one-off backup that runs immediately.' },
    ],
    buildSpec: (values, ctx) => {
      const spec = {
        mariaDbRef: { name: '__INSTANCE__' },
        target: values.target,
      }
      if (values.storageType !== 'VolumeSnapshot') spec.compression = values.compression
      if (values.storageType === 'S3') {
        spec.storage = { s3: s3StorageSpec(values, ctx) }
      } else if (values.storageType === 'VolumeSnapshot') {
        spec.storage = { volumeSnapshot: { volumeSnapshotClassName: values.volumeSnapshotClassName } }
      } else {
        spec.storage = { persistentVolumeClaim: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: values.storageSize } } } }
      }
      if (values.cron?.trim()) spec.schedule = { cron: values.cron.trim() }
      return spec
    },
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.target', label: 'Target' },
      { key: 'spec.storage', label: 'Destination', render: (_v, item) => storageDestination(_v, item) },
      { key: 'spec.schedule.cron', label: 'Schedule', render: v => v || 'One-off' },
      { key: 'status', label: 'Status' },
      { key: 'creationTimestamp', label: 'Created', render: relTime },
    ],
  },

  pointintimerecovery: {
    kind: 'pointintimerecovery', apiKind: 'PointInTimeRecovery', label: 'Point-in-Time Recovery', pluralLabel: 'PITR',
    icon: 'Clock3', accent: '#79c0ff', scope: 'namespace',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'physicalBackupRef', label: 'Physical backup', type: 'ref-select', refKind: 'physicalbackup', required: true, specField: 'physicalBackupRef.name' },
      { key: 'storageSize', label: 'Storage size', type: 'text', default: '1Gi', specField: 'storage.persistentVolumeClaim.resources.requests.storage' },
      { key: 'targetRecoveryTime', label: 'Target recovery time (RFC3339, optional)', type: 'text', help: 'e.g. 2026-08-05T12:00:00Z — leave blank to recover to the latest point available.' },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.physicalBackupRef.name', label: 'From physical backup' },
      { key: 'status', label: 'Status' },
      { key: 'creationTimestamp', label: 'Created', render: relTime },
    ],
  },

  sqljob: {
    kind: 'sqljob', apiKind: 'SqlJob', label: 'SQL Job', pluralLabel: 'SQL Jobs',
    icon: 'Terminal', accent: '#e3b341', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true, help: 'Must match an existing User with access to run this SQL.' },
      { key: 'password', label: 'Password', type: 'password', secretKey: 'password', specField: 'passwordSecretKeyRef', required: true },
      { key: 'database', label: 'Database', type: 'text', help: "Required unless your SQL fully-qualifies table names or starts with its own USE statement — most SQL (e.g. CREATE TABLE) needs a database selected to run against." },
      { key: 'sql', label: 'SQL', type: 'textarea', required: true, placeholder: 'CREATE TABLE ...;', rows: 8 },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.username', label: 'Username' },
      { key: 'status', label: 'Status' },
      { key: 'creationTimestamp', label: 'Created', render: relTime },
    ],
  },

  connection: {
    kind: 'connection', apiKind: 'Connection', label: 'Connection', pluralLabel: 'Connections',
    icon: 'Link2', accent: '#a5d6ff', scope: 'instance',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, help: 'Also used as the generated Secret name unless overridden.' },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', secretKey: 'password', specField: 'passwordSecretKeyRef', required: true },
      { key: 'database', label: 'Database (optional)', type: 'text' },
    ],
    buildSpec: (values, ctx) => ({
      mariaDbRef: { name: '__INSTANCE__' },
      username: values.username,
      passwordSecretKeyRef: { name: ctx.secretNames.password, key: 'password' },
      database: values.database || undefined,
      secretName: values.name,
    }),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.username', label: 'Username' },
      { key: 'spec.database', label: 'Database' },
      { key: 'status', label: 'Status' },
    ],
  },

  maxscale: {
    kind: 'maxscale', apiKind: 'MaxScale', label: 'MaxScale', pluralLabel: 'MaxScale',
    icon: 'Route', accent: '#ff7b72', scope: 'namespace', standalone: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'mariaDbRef', label: 'MariaDB instance', type: 'ref-select', refKind: 'mariadb', required: true, specField: 'mariaDbRef.name' },
      { key: 'replicas', label: 'Replicas', type: 'number', default: 2 },
    ],
    buildSpec: (values) => ({
      mariaDbRef: { name: values.mariaDbRef },
      replicas: Number(values.replicas),
      services: [
        { name: 'rw-router', router: 'readwritesplit', listener: { port: 3306 } },
      ],
    }),
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.mariaDbRef.name', label: 'MariaDB' },
      { key: 'spec.replicas', label: 'Replicas' },
      { key: 'status', label: 'Status' },
    ],
  },

  externalmariadb: {
    kind: 'externalmariadb', apiKind: 'ExternalMariaDB', label: 'External MariaDB', pluralLabel: 'External MariaDBs',
    icon: 'Globe', accent: '#8b949e', scope: 'namespace', standalone: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'mariadb.other-namespace.svc.cluster.local' },
      { key: 'port', label: 'Port', type: 'number', default: 3306 },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', secretKey: 'password', specField: 'passwordSecretKeyRef', required: true },
    ],
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'spec.host', label: 'Host' },
      { key: 'spec.port', label: 'Port' },
      { key: 'status', label: 'Status' },
    ],
  },
}

// ── shared column render helpers ────────────────────────────────────────────────

export function storageDestination(_v, item) {
  const storage = item.spec?.storage || {}
  if (storage.s3) return `S3: ${storage.s3.bucket}`
  if (storage.volumeSnapshot) return `VolumeSnapshot: ${storage.volumeSnapshot.volumeSnapshotClassName}`
  if (storage.azureBlob) return `Azure: ${storage.azureBlob.containerName}`
  if (storage.persistentVolumeClaim) return `PVC (${storage.persistentVolumeClaim.resources?.requests?.storage ?? '—'})`
  return '—'
}

export function statusFromConditions(_v, item) {
  const ready = item.status?.conditions?.find(c => c.type === 'Ready' || c.type === 'Complete')
  if (!ready) return 'Pending'
  return ready.status === 'True' ? (ready.reason || 'Ready') : (ready.reason || 'Failed')
}

export function relTime(v) {
  if (!v) return '—'
  const ms = Date.now() - new Date(v).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (min < 1440) return `${Math.floor(min / 60)}h ago`
  return `${Math.floor(min / 1440)}d ago`
}

export function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

// Instance-detail tabs (in display order) vs. standalone top-level pages.
export const INSTANCE_CRD_TABS = ['database', 'user', 'grant', 'backup', 'restore', 'physicalbackup', 'pointintimerecovery', 'sqljob', 'connection']
export const STANDALONE_CRD_PAGES = ['maxscale', 'externalmariadb']
