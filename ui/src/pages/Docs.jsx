import { BookOpen, ExternalLink, Rocket, Network, Wrench, ShieldCheck } from 'lucide-react'

const REPO_BLOB = 'https://github.com/arthurking87/mariadb-operator/blob/main/docs'

const sections = [
  {
    title: 'Getting started',
    icon: Rocket,
    accent: '#3fb950',
    docs: [
      { file: 'quickstart.md',     label: 'Quickstart' },
      { file: 'configuration.md',  label: 'Configuration reference' },
      { file: 'helm.md',           label: 'Helm installation' },
    ],
  },
  {
    title: 'Topology',
    icon: Network,
    accent: '#58a6ff',
    docs: [
      { file: 'standalone.md',        label: 'Standalone' },
      { file: 'replication.md',       label: 'Replication' },
      { file: 'galera.md',            label: 'Galera' },
      { file: 'high_availability.md', label: 'High availability' },
      { file: 'multi-cluster.md',     label: 'Multi-cluster' },
    ],
  },
  {
    title: 'Operations',
    icon: Wrench,
    accent: '#f97316',
    docs: [
      { file: 'logical_backup.md',  label: 'Logical backup' },
      { file: 'physical_backup.md', label: 'Physical backup' },
      { file: 'pitr.md',            label: 'Point-in-time recovery' },
      { file: 'updates.md',         label: 'Updates' },
      { file: 'maintenance.md',     label: 'Maintenance' },
      { file: 'suspend.md',         label: 'Suspend' },
    ],
  },
  {
    title: 'Connectivity & security',
    icon: ShieldCheck,
    accent: '#bc8cff',
    docs: [
      { file: 'connections.md', label: 'Connections' },
      { file: 'maxscale.md',    label: 'MaxScale' },
      { file: 'tls.md',         label: 'TLS' },
      { file: 'security.md',    label: 'Security' },
    ],
  },
]

export default function Docs() {
  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: '#e6edf3' }}>Docs</h1>
        <p className="text-sm mt-0.5" style={{ color: '#8b949e' }}>
          Reference documentation for this operator, opens on GitHub in a new tab.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {sections.map(({ title, icon: Icon, accent, docs }) => (
          <div key={title} className="rounded-xl border p-5" style={{ background: '#161b22', borderColor: '#21262d' }}>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: accent + '22' }}>
                <Icon size={16} color={accent} />
              </div>
              <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{title}</h2>
            </div>
            <div className="flex flex-col gap-0.5">
              {docs.map(({ file, label }) => (
                <a
                  key={file}
                  href={`${REPO_BLOB}/${file}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm transition-colors"
                  style={{ color: '#8b949e' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1c2330'; e.currentTarget.style.color = '#e6edf3' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8b949e' }}
                >
                  <span>{label}</span>
                  <ExternalLink size={12} className="flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-6 text-xs" style={{ color: '#8b949e' }}>
        <BookOpen size={13} />
        Full documentation index:{' '}
        <a href={`${REPO_BLOB}/README.md`} target="_blank" rel="noreferrer" style={{ color: '#f97316' }}>docs/README.md</a>
      </div>
    </div>
  )
}
