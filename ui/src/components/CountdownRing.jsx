export default function CountdownRing({ count, total, paused, onTogglePause }) {
  const r     = 9
  const circ  = 2 * Math.PI * r
  const dash  = circ * (count / total)
  const color = paused ? '#8b949e' : '#f97316'

  return (
    <button
      onClick={onTogglePause}
      title={paused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
      className="flex items-center gap-1.5 group"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
    >
      {/* ring + icon */}
      <div className="relative flex items-center justify-center" style={{ width: 22, height: 22 }}>
        <svg width="22" height="22" style={{ transform: 'rotate(-90deg)', position: 'absolute' }}>
          <circle cx="11" cy="11" r={r} fill="none" stroke="#21262d" strokeWidth="2" />
          <circle
            cx="11" cy="11" r={r}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            style={{ transition: paused ? 'none' : 'stroke-dasharray 0.9s linear' }}
          />
        </svg>
        {/* pause / play icon in the centre */}
        <span style={{ fontSize: 8, color, lineHeight: 1, position: 'relative', zIndex: 1 }}>
          {paused ? '▶' : '⏸'}
        </span>
      </div>

      {/* countdown number */}
      <span
        className="text-xs tabular-nums"
        style={{ color: paused ? '#8b949e' : '#8b949e', minWidth: 18, opacity: paused ? 0.5 : 1 }}
      >
        {paused ? '--' : `${count}s`}
      </span>
    </button>
  )
}
