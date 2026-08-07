import { useState, useRef, useCallback, useEffect } from 'react'
import { Database, LayoutDashboard, Settings, Activity, BookOpen, Gauge, ArrowRightLeft, Archive, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

const nav = [
  { id: 'dashboard',   label: 'Instances', icon: LayoutDashboard },
  { id: 'switchover',  label: 'Switchover', icon: ArrowRightLeft },
  { id: 'backups',     label: 'Backups/Restores', icon: Archive },
  { id: 'capacity',    label: 'Capacity', icon: Gauge },
  { id: 'activity',    label: 'Activity', icon: Activity },
  { id: 'docs',        label: 'Docs', icon: BookOpen },
  { id: 'settings',    label: 'Settings', icon: Settings },
]

// Separate localStorage key from src/lib/settings.js on purpose: that module's get/set
// round-trips the whole settings blob through JSON on every call, fine for occasional form
// saves but wasteful fired on every pointermove of a drag; and sidebar width isn't a
// "preference" with a field on the Settings page, it's persisted layout state. Only ever
// read once on mount and written once per drag (on pointerup), not on every pointermove.
const WIDTH_KEY = 'mariadb-ui:sidebar-width'
const MIN_WIDTH = 180
const MAX_WIDTH = 360
const DEFAULT_WIDTH = 224

// Custom-drawn horizontal-resize cursor (small double-headed arrow, white fill/black
// outline so it reads on any background) instead of relying on the CSS `col-resize`
// keyword alone. That keyword depends on the OS supplying the actual cursor bitmap;
// inside a remote desktop (this one runs under KasmVNC) the cursor theme is often
// incomplete and several distinct resize keywords silently fall back to the same generic
// bitmap — reported as this handle's cursor rendering as an up/down arrow instead of
// left/right even though `getComputedStyle` correctly reported `col-resize`. Embedding the
// icon as an SVG data URI (with `col-resize` kept as the fallback keyword) sidesteps the
// OS cursor theme entirely, so the arrow direction is guaranteed correct everywhere.
const RESIZE_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'>` +
  `<g fill='#ffffff' stroke='#000000' stroke-width='1' stroke-linejoin='round'>` +
  `<path d='M2 9 L6 5 L6 8 L12 8 L12 5 L16 9 L12 13 L12 10 L6 10 L6 13 Z'/>` +
  `</g></svg>`
const RESIZE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(RESIZE_CURSOR_SVG)}") 9 9, col-resize`

export default function Sidebar({ page, setPage }) {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    return stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH
  })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef(null) // { pointerX, startWidth }
  // onUp (below) is set up once per drag via the `dragging` effect, so its closure only sees
  // `width` as of drag-start — this ref tracks the live value across every onMove so onUp can
  // persist the width actually released at, not the stale one from when the drag began.
  const widthRef = useRef(width)

  const onHandlePointerDown = useCallback(e => {
    e.preventDefault()
    dragStart.current = { pointerX: e.clientX, startWidth: width }
    setDragging(true)
  }, [width])

  useEffect(() => {
    if (!dragging) return
    // Standard resizer polish: lock the cursor/selection to the whole document for the
    // duration of the drag, not just while the pointer stays over the 6px handle — otherwise
    // fast mouse movement escapes the handle and starts selecting nav label text instead.
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = RESIZE_CURSOR
    document.body.style.userSelect = 'none'
    const onMove = e => {
      const { pointerX, startWidth } = dragStart.current
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (e.clientX - pointerX)))
      widthRef.current = next
      setWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      localStorage.setItem(WIDTH_KEY, String(widthRef.current))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r relative"
      style={{
        background: '#0d1117', borderColor: '#21262d', width: collapsed ? 64 : width,
        transition: dragging ? 'none' : 'width 0.2s',
      }}
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

      {/* Drag-to-resize handle — only meaningful when expanded; collapsed is a fixed-width
          icon-only mode with nothing to resize into. */}
      {!collapsed && (
        <div
          onPointerDown={onHandlePointerDown}
          title="Drag to resize"
          className="absolute top-0 right-0 h-full"
          style={{
            width: 6, marginRight: -3, cursor: RESIZE_CURSOR, zIndex: 10,
            background: dragging ? 'rgba(249,115,22,0.5)' : 'transparent',
          }}
          onMouseEnter={e => { if (!dragging) e.currentTarget.style.background = 'rgba(249,115,22,0.3)' }}
          onMouseLeave={e => { if (!dragging) e.currentTarget.style.background = 'transparent' }}
        />
      )}
    </aside>
  )
}
