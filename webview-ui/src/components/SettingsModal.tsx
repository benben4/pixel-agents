import { useState } from 'react'
import { vscode } from '../vscodeApi.js'
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js'
import { DEFAULT_MONITOR_SETTINGS } from '../hooks/useExtensionMessages.js'
import type { MonitorSettings } from '../hooks/useExtensionMessages.js'
import {
  MONITOR_CHARACTER_LIMIT,
  MONITOR_AGENT_LABEL_FONT_MAX_PX,
  MONITOR_AGENT_LABEL_FONT_MIN_PX,
} from '../constants.js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  monitorSettings: MonitorSettings
  onUpdateMonitorSettings: (settings: MonitorSettings) => void
  demoMode: boolean
  onUpdateDemoMode: (enabled: boolean) => void
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, monitorSettings, onUpdateMonitorSettings, demoMode, onUpdateDemoMode }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)

  if (!isOpen) return null

  return (
    <>
      {/* Dark backdrop — click to close */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* Centered modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 200,
        }}
      >
        {/* Header with title and X button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>Settings</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>
        {/* Menu items */}
        <button
          onClick={() => {
            vscode.postMessage({ type: 'openSessionsFolder' })
            onClose()
          }}
          onMouseEnter={() => setHovered('sessions')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sessions' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Open Sessions Folder
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'exportLayout' })
            onClose()
          }}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Export Layout
        </button>
        <button
          onClick={() => {
            vscode.postMessage({ type: 'importLayout' })
            onClose()
          }}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          Import Layout
        </button>
        <button
          onClick={() => {
            const newVal = !isSoundEnabled()
            setSoundEnabled(newVal)
            setSoundLocal(newVal)
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal })
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Sound Notifications</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={() => onUpdateDemoMode(!demoMode)}
          onMouseEnter={() => setHovered('demo')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'demo' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Demo Mode</span>
          <span
            style={{
              width: 14,
              height: 14,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: demoMode ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {demoMode ? 'X' : ''}
          </span>
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>Debug View</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
        <div style={{ borderTop: '1px solid var(--pixel-border)', marginTop: 4, paddingTop: 4 }}>
          <div style={{ fontSize: '20px', color: 'rgba(255,255,255,0.9)', padding: '2px 10px' }}>Monitor</div>
          <MonitorToggle label="Enable Monitor" value={monitorSettings.enabled} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, enabled: value })} />
          <MonitorToggle label="ClaudeCode Source" value={monitorSettings.enableClaude} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, enableClaude: value })} />
          <MonitorToggle label="OpenCode Source" value={monitorSettings.enableOpencode} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, enableOpencode: value })} />
          <MonitorToggle label="Codex Source" value={monitorSettings.enableCodex} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, enableCodex: value })} />
          <MonitorToggle label="Git Polling" value={monitorSettings.enableGit} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, enableGit: value })} />
          <MonitorToggle label="PR Polling" value={monitorSettings.enablePr} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, enablePr: value })} />
          <MonitorInterval label="Flush ms" value={monitorSettings.flushIntervalMs} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, flushIntervalMs: value })} />
          <MonitorInterval label="Source poll ms" value={monitorSettings.sourcePollIntervalMs} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, sourcePollIntervalMs: value })} />
          <MonitorInterval label="Git poll ms" value={monitorSettings.gitPollIntervalMs} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, gitPollIntervalMs: value })} />
          <MonitorInterval label="PR poll ms" value={monitorSettings.prPollIntervalMs} onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, prPollIntervalMs: value })} />
          <MonitorInterval
            label="Agent Title Font px"
            value={monitorSettings.agentLabelFontPx}
            onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, agentLabelFontPx: value })}
            min={MONITOR_AGENT_LABEL_FONT_MIN_PX}
            max={MONITOR_AGENT_LABEL_FONT_MAX_PX}
            step={1}
          />
          <MonitorInterval
            label="Max Idle Agents"
            value={monitorSettings.maxIdleAgents}
            onChange={(value) => onUpdateMonitorSettings({ ...monitorSettings, maxIdleAgents: value })}
            min={0}
            max={MONITOR_CHARACTER_LIMIT}
            step={1}
          />
          <button
            onClick={() => onUpdateMonitorSettings(DEFAULT_MONITOR_SETTINGS)}
            style={{ ...menuItemBase, padding: '4px 10px', fontSize: '20px' }}
          >
            Reset Monitor Settings
          </button>
        </div>
      </div>
    </>
  )
}

function MonitorToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{ ...menuItemBase, padding: '4px 10px', fontSize: '20px' }}
    >
      <span>{label}</span>
      <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.5)', background: value ? 'rgba(90, 140, 255, 0.8)' : 'transparent' }} />
    </button>
  )
}

function MonitorInterval(
  {
    label,
    value,
    onChange,
    min = 500,
    max,
    step = 500,
  }: {
    label: string
    value: number
    onChange: (value: number) => void
    min?: number
    max?: number
    step?: number
  },
) {
  const clamp = (nextValue: number): number => {
    const lower = Math.max(min, nextValue)
    if (typeof max === 'number') {
      return Math.min(max, lower)
    }
    return lower
  }

  return (
    <div style={{ ...menuItemBase, padding: '4px 10px', fontSize: '20px' }}>
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          style={{
            width: 24,
            height: 24,
            fontSize: '16px',
            lineHeight: 1,
            background: '#c23b3b',
            color: '#fff',
            border: '1px solid #f38b8b',
            borderRadius: 0,
            cursor: 'pointer',
          }}
          title="Decrease"
        >
          -
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number.parseInt(e.target.value || '0', 10) || min))}
          style={{ width: 90, fontSize: '18px', background: 'var(--pixel-bg)', color: 'var(--pixel-text)', border: '1px solid var(--pixel-border)' }}
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          style={{
            width: 24,
            height: 24,
            fontSize: '16px',
            lineHeight: 1,
            background: '#2c9f5a',
            color: '#fff',
            border: '1px solid #79d9a3',
            borderRadius: 0,
            cursor: 'pointer',
          }}
          title="Increase"
        >
          +
        </button>
      </div>
    </div>
  )
}
