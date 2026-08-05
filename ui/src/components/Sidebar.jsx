import { useState } from 'react'
import { Database, LayoutDashboard, Settings, Activity, BookOpen, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

const nav = [
  { id: 'dashboard', label: 'Instances', icon: LayoutDashboard },
  { id: 'activity',  label: 'Activity', icon: Activity },
  { id: 'docs',      label: 'Docs', icon: BookOpen },
  { id: 'settings',  label: 'Settings', icon: Settings },
]

export default function Sidebar({ page, setPage }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r transition-[width] duration-200"
      style={{ background: '#0d1117', borderColor: '#21262d', width: collapsed ? 64 : 224 }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 py-5 border-b"
        style={{ borderColor: '#21262d', paddingLeft: collapsed ? 0 : 20, paddingRight: collapsed ? 0 : 20, justifyContent: collapsed ? 'center' : 'flex-start' }}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0" style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)' }}>
          <Database size={16} color="white" strokeWidth={2.5} />
        </div>
        {!collapsed && (
          <div className="overflow-hidden whitespace-nowrap">
            <div className="text-sm font-semibold" style={{ color: '#e6edf3' }}>MariaDB</div>
            <div className="text-xs" style={{ color: '#8b949e' }}>Operator UI</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {nav.map(({ id, label, icon: Icon }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => setPage(id)}
              title={collapsed ? label : undefined}
              className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-all text-left"
              style={{
                background: active ? '#1c2330' : 'transparent',
                color: active ? '#e6edf3' : '#8b949e',
                border: active ? '1px solid #30363d' : '1px solid transparent',
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
            >
              <Icon size={15} className="flex-shrink-0" />
              {!collapsed && <span className="overflow-hidden whitespace-nowrap">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Cluster badge */}
      {!collapsed && (
        <div className="px-3 pb-3">
          <div className="rounded-lg p-3 border" style={{ background: '#161b22', borderColor: '#21262d' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              <span className="text-xs font-medium" style={{ color: '#3fb950' }}>Connected</span>
            </div>
            <div className="text-xs truncate" style={{ color: '#8b949e' }}>kind-control-plane</div>
            <div className="text-xs" style={{ color: '#8b949e' }}>v1.35.0</div>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="px-3 pb-4 border-t pt-3" style={{ borderColor: '#21262d' }}>
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium transition-all"
          style={{ color: '#8b949e', justifyContent: collapsed ? 'center' : 'flex-start' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#161b22'; e.currentTarget.style.color = '#e6edf3' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8b949e' }}
        >
          {collapsed ? <PanelLeftOpen size={15} className="flex-shrink-0" /> : <PanelLeftClose size={15} className="flex-shrink-0" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
