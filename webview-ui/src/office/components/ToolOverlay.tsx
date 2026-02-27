import { useState, useEffect } from 'react'
import type { ToolActivity } from '../types.js'
import type { OfficeState } from '../engine/officeState.js'
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js'
import { TILE_SIZE, CharacterState } from '../types.js'
import {
  TOOL_OVERLAY_VERTICAL_OFFSET,
  TOOL_OVERLAY_REFRESH_MS,
  CHARACTER_SITTING_OFFSET_PX,
  MONITOR_AGENT_ID_BASE,
  MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
  MONITOR_AGENT_LABEL_FONT_MAX_PX,
  MONITOR_AGENT_LABEL_FONT_MIN_PX,
} from '../../constants.js'

interface ToolOverlayProps {
  officeState: OfficeState
  agents: number[]
  agentTools: Record<number, ToolActivity[]>
  subagentCharacters: SubagentCharacter[]
  monitorCharacterIds: number[]
  monitorActivityById: Record<number, { state: 'idle' | 'thinking' | 'running' | 'waiting' | 'done' | 'error'; text: string }>
  agentLabelFontPx: number
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  onCloseAgent: (id: number) => void
  hideMonitorOverlays?: boolean
  demoMode?: boolean
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId]
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done)
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval'
      return activeTool.status
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1]
      if (lastTool) return lastTool.status
    }
  }

  return 'Idle'
}

function monitorTextColor(state: 'idle' | 'thinking' | 'running' | 'waiting' | 'done' | 'error'): string {
  if (state === 'running' || state === 'thinking') return '#74d680'
  if (state === 'error') return '#ff6b6b'
  if (state === 'waiting') return '#ffd166'
  return '#ffffff'
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  monitorCharacterIds,
  monitorActivityById,
  agentLabelFontPx,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  hideMonitorOverlays = false,
  demoMode = false,
}: ToolOverlayProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((n) => n + 1)
    }, TOOL_OVERLAY_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const selectedId = officeState.selectedAgentId
  const hoveredId = officeState.hoveredAgentId
  const monitorSet = new Set(monitorCharacterIds)
  const baseLabelFontPx = Math.min(
    MONITOR_AGENT_LABEL_FONT_MAX_PX,
    Math.max(
      MONITOR_AGENT_LABEL_FONT_MIN_PX,
      Number.isFinite(agentLabelFontPx) ? Math.round(agentLabelFontPx) : MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
    ),
  )

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        const isSelected = selectedId === id
        const isHovered = hoveredId === id
        const isSub = ch.isSubagent
        const isMonitor = monitorSet.has(id) || id >= MONITOR_AGENT_ID_BASE
        if (isMonitor && hideMonitorOverlays) return null
        const monitorActivity = isMonitor ? monitorActivityById[id] : undefined
        const shouldAlwaysShowMonitor = Boolean(
          monitorActivity &&
          (monitorActivity.state === 'running' ||
            monitorActivity.state === 'thinking' ||
            monitorActivity.state === 'waiting' ||
            monitorActivity.state === 'error'),
        )

        const shouldAlwaysShowDemo = demoMode && !isSub
        if (!isSelected && !isHovered && !shouldAlwaysShowMonitor && !shouldAlwaysShowDemo) return null

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission'
        let activityText: string
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval'
          } else {
            const sub = subagentCharacters.find((s) => s.id === id)
            activityText = sub ? sub.label : 'Subtask'
          }
        } else if (demoMode) {
          activityText = ch.currentTool ?? 'Demo: Working'
        } else if (isMonitor && monitorActivity) {
          activityText = monitorActivity.text
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive)
        }

        // Determine dot color
        const tools = agentTools[id]
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done)
        const hasActiveTools = tools?.some((t) => !t.done)
        const isActive = ch.isActive

        let dotColor: string | null = null
        if (demoMode && !isSub) {
          dotColor = 'var(--pixel-status-active)'
        } else if (hasPermission) {
          dotColor = 'var(--pixel-status-permission)'
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--pixel-status-active)'
        }

        const labelColor = demoMode && !isSub
          ? 'var(--pixel-status-active)'
          : isMonitor && monitorActivity
            ? monitorTextColor(monitorActivity.state)
            : 'var(--vscode-foreground, var(--pixel-text))'

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: isSelected ? 'auto' : 'none',
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--pixel-bg)',
                border: isSelected
                  ? '2px solid var(--pixel-border-light)'
                  : '2px solid var(--pixel-border)',
                borderRadius: 0,
                padding: isSelected ? '3px 6px 3px 8px' : '3px 8px',
                boxShadow: 'var(--pixel-shadow)',
                whiteSpace: 'nowrap',
                maxWidth: 220,
              }}
            >
              {dotColor && (
                <span
                  className={isActive && !hasPermission ? 'pixel-agents-pulse' : undefined}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontSize: `${isSub ? Math.max(MONITOR_AGENT_LABEL_FONT_MIN_PX, baseLabelFontPx - 2) : baseLabelFontPx}px`,
                  fontStyle: isSub ? 'italic' : undefined,
                  color: labelColor,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activityText}
              </span>
              {isSelected && !isSub && !isMonitor && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseAgent(id)
                  }}
                  title="Close agent"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--pixel-close-text)',
                    cursor: 'pointer',
                    padding: '0 2px',
                    fontSize: '26px',
                    lineHeight: 1,
                    marginLeft: 2,
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)'
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
