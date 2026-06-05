import { useState, useEffect, useRef, useCallback } from 'react'

export function useAutoRefresh(onRefresh, interval = 10) {
  const [count, setCount] = useState(interval)
  const [paused, setPaused] = useState(false)
  const callbackRef = useRef(onRefresh)
  callbackRef.current = onRefresh

  useEffect(() => {
    if (paused) return
    const tick = setInterval(() => {
      setCount(c => {
        if (c <= 1) {
          callbackRef.current()
          return interval
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [paused, interval])

  const reset       = useCallback(() => setCount(interval), [interval])
  const togglePause = useCallback(() => setPaused(p => !p), [])

  return { count, reset, total: interval, paused, togglePause }
}
