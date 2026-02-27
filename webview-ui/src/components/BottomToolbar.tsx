import { useState } from 'react'
import { SettingsModal } from './SettingsModal.js'
import type { MonitorSettings } from '../hooks/useExtensionMessages.js'

interface BottomToolbarProps {
  isEditMode: boolean
  onOpenAgent: (source: 'claude' | 'opencode' | 'codex') => void
  onToggleEditMode: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  monitorSettings: MonitorSettings
  onUpdateMonitorSettings: (settings: MonitorSettings) => void
  demoMode: boolean
  onUpdateDemoMode: (enabled: boolean) => void
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
}


export function BottomToolbar({
  isEditMode,
  onOpenAgent,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  monitorSettings,
  onUpdateMonitorSettings,
  demoMode,
  onUpdateDemoMode,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAgentMenuOpen, setIsAgentMenuOpen] = useState(false)

  return (
    <div style={panelStyle}>
      <button
        onClick={() => setIsAgentMenuOpen((v) => !v)}
        onMouseEnter={() => setHovered('agent')}
        onMouseLeave={() => setHovered(null)}
        style={{
          ...btnBase,
          padding: '5px 12px',
          background:
            hovered === 'agent'
              ? 'var(--pixel-agent-hover-bg)'
              : 'var(--pixel-agent-bg)',
          border: '2px solid var(--pixel-agent-border)',
          color: 'var(--pixel-agent-text)',
        }}
        title="Create agent terminal"
      >
        + Agent
      </button>
      {isAgentMenuOpen && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            bottom: 56,
            zIndex: 'var(--pixel-controls-z)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            boxShadow: 'var(--pixel-shadow)',
            padding: 4,
          }}
        >
          <button style={btnBase} onClick={() => { onOpenAgent('claude'); setIsAgentMenuOpen(false) }}>Claude Code</button>
          <button style={btnBase} onClick={() => { onOpenAgent('opencode'); setIsAgentMenuOpen(false) }}>OpenCode</button>
          <button style={btnBase} onClick={() => { onOpenAgent('codex'); setIsAgentMenuOpen(false) }}>Codex</button>
        </div>
      )}
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background: hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
          monitorSettings={monitorSettings}
          onUpdateMonitorSettings={onUpdateMonitorSettings}
          demoMode={demoMode}
          onUpdateDemoMode={onUpdateDemoMode}
        />
      </div>
    </div>
  )
}
