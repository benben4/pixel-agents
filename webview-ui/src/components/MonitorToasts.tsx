import { useEffect } from 'react'
import type { MonitorToast } from '../hooks/useExtensionMessages.js'
import {
  MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
  MONITOR_AGENT_LABEL_FONT_MAX_PX,
  MONITOR_AGENT_LABEL_FONT_MIN_PX,
  MONITOR_TOAST_DURATION_MS,
} from '../constants.js'

interface MonitorToastsProps {
  toasts: MonitorToast[]
  onDismiss: (id: string) => void
  agentLabelFontPx: number
}

function clampLabelFontPx(value: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : MONITOR_AGENT_LABEL_FONT_DEFAULT_PX
  return Math.min(MONITOR_AGENT_LABEL_FONT_MAX_PX, Math.max(MONITOR_AGENT_LABEL_FONT_MIN_PX, rounded))
}

export function MonitorToasts({ toasts, onDismiss, agentLabelFontPx }: MonitorToastsProps) {
  const baseFontPx = clampLabelFontPx(agentLabelFontPx)
  const titleFontPx = Math.max(14, baseFontPx - 4)
  const bodyFontPx = Math.max(13, baseFontPx - 6)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) => setTimeout(() => onDismiss(t.id), MONITOR_TOAST_DURATION_MS))
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [toasts, onDismiss])

  return (
    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {toasts.map((toast) => (
        <div key={toast.id} style={{ minWidth: 220, maxWidth: 360, background: 'var(--pixel-bg)', border: '2px solid var(--pixel-border)', boxShadow: 'var(--pixel-shadow)', padding: '5px 7px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: `${titleFontPx}px`, color: toast.kind === 'error' ? '#f38b8b' : '#9fe6b2' }}>{toast.title}</div>
            <button
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
              style={{
                width: 22,
                height: 22,
                padding: 0,
                background: 'var(--pixel-bg)',
                color: 'var(--pixel-text)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--pixel-shadow)',
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              x
            </button>
          </div>
          <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>{toast.message}</div>
        </div>
      ))}
    </div>
  )
}
