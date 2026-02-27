import { useEffect, useState } from 'react'
import type { ToolActivity, Character } from '../office/types.js'
import type { OfficeState } from '../office/engine/officeState.js'
import type { MonitorAgentView, SubagentCharacter } from '../hooks/useExtensionMessages.js'
import { MONITOR_AGENT_ID_BASE, INFO_BOARD_REFRESH_MS } from '../constants.js'

interface CharacterInfoBoardProps {
  officeState: OfficeState
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  subagentCharacters: SubagentCharacter[]
  monitorActivityById: Record<number, { state: MonitorAgentView['state']; text: string }>
  anchor: { x: number; y: number } | null
  hideMonitorAgent?: boolean
  demoMode?: boolean
}

function buildTitle(ch: Character, subagentCharacters: SubagentCharacter[]): string {
  if (ch.id >= MONITOR_AGENT_ID_BASE) return 'Monitor Agent'
  if (ch.isSubagent) {
    const sub = subagentCharacters.find((item) => item.id === ch.id)
    return sub ? `Sub-agent: ${sub.label}` : `Sub-agent #${Math.abs(ch.id)}`
  }
  return `Agent #${ch.id}`
}

function latestActivity(
  ch: Character,
  agentTools: Record<number, ToolActivity[]>,
  monitorActivityById: Record<number, { state: MonitorAgentView['state']; text: string }>,
  demoMode: boolean,
): string {
  if (demoMode && !ch.isSubagent) {
    return ch.currentTool ?? 'Demo: Working'
  }
  if (ch.id >= MONITOR_AGENT_ID_BASE) {
    return monitorActivityById[ch.id]?.text ?? 'Monitor idle'
  }
  const tools = agentTools[ch.id] ?? []
  const active = [...tools].reverse().find((tool) => !tool.done)
  if (active?.status) return active.status
  if (ch.currentTool) return ch.currentTool
  return ch.isActive ? 'Active' : 'Idle'
}

export function CharacterInfoBoard({
  officeState,
  agentTools,
  agentStatuses,
  subagentCharacters,
  monitorActivityById,
  anchor,
  hideMonitorAgent = false,
  demoMode = false,
}: CharacterInfoBoardProps) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((n) => n + 1)
    }, INFO_BOARD_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const selectedId = officeState.selectedAgentId
  if (selectedId === null) return null

  const ch = officeState.characters.get(selectedId)
  if (!ch) return null
  if (hideMonitorAgent && ch.id >= MONITOR_AGENT_ID_BASE) return null

  const statusText = demoMode && !ch.isSubagent
    ? 'active'
    : (agentStatuses[selectedId] ?? (ch.isActive ? 'active' : 'idle'))
  const activityText = latestActivity(ch, agentTools, monitorActivityById, demoMode)
  const recentTools = (agentTools[selectedId] ?? []).slice(-4).reverse()
  const title = buildTitle(ch, subagentCharacters)

  const panelWidth = 360
  const panelHeight = 320
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : panelWidth + 20
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : panelHeight + 20
  const rawLeft = anchor ? anchor.x + 12 : 10
  const rawTop = anchor ? anchor.y - 12 : 10
  const left = Math.max(8, Math.min(viewportWidth - panelWidth - 8, rawLeft))
  const top = Math.max(8, Math.min(viewportHeight - panelHeight - 8, rawTop))

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left,
        zIndex: 'var(--pixel-controls-z)',
        width: panelWidth,
        maxHeight: '48vh',
        overflow: 'auto',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        boxShadow: 'var(--pixel-shadow)',
        color: 'var(--pixel-text)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--pixel-border)',
          padding: '6px 8px',
        }}
      >
        <div style={{ fontSize: '20px', color: '#ffffff' }}>{title}</div>
        <button
          onClick={() => {
            officeState.selectedAgentId = null
            officeState.cameraFollowId = null
          }}
          style={{
            padding: '2px 8px',
            border: '1px solid var(--pixel-border)',
            borderRadius: 0,
            background: 'var(--pixel-btn-bg)',
            color: 'var(--pixel-text)',
            cursor: 'pointer',
            fontSize: '16px',
          }}
          title="Close board"
        >
          X
        </button>
      </div>

      <div style={{ padding: '8px', fontSize: '18px', display: 'grid', gap: 4 }}>
        <div>State: {ch.state}</div>
        <div>Status: {statusText}</div>
        <div>Activity: {activityText}</div>
        <div>Tile: ({ch.tileCol}, {ch.tileRow})</div>
        <div>Seat: {ch.seatId ?? 'none'}</div>
        <div>Tool: {ch.currentTool ?? 'none'}</div>
        <div>Bubble: {ch.bubbleType ?? 'none'}</div>
        <div>Palette: {ch.palette} / Hue: {ch.hueShift}</div>
      </div>

      {recentTools.length > 0 && (
        <div style={{ borderTop: '1px solid var(--pixel-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '18px', marginBottom: 4, color: '#ffffff' }}>Recent Tools</div>
          {recentTools.map((tool) => (
            <div key={tool.toolId} style={{ fontSize: '16px', color: tool.done ? 'var(--pixel-text-dim)' : '#74d680' }}>
              - {tool.status}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
