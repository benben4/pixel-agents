import { useState } from 'react'
import type { MonitorAgentView, MonitorSnapshot } from '../hooks/useExtensionMessages.js'
import { vscode } from '../vscodeApi.js'
import {
  MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
  MONITOR_AGENT_LABEL_FONT_MAX_PX,
  MONITOR_AGENT_LABEL_FONT_MIN_PX,
} from '../constants.js'

interface MonitorDashboardProps {
  snapshot: MonitorSnapshot | null
  agentLabelFontPx: number
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  width: 360,
  maxHeight: '55vh',
  overflow: 'auto',
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  boxShadow: 'var(--pixel-shadow)',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '20px',
  color: 'var(--pixel-text)',
}

const actionBtn: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '16px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '1px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
}

function clampLabelFontPx(value: number): number {
  const rounded = Number.isFinite(value) ? Math.round(value) : MONITOR_AGENT_LABEL_FONT_DEFAULT_PX
  return Math.min(MONITOR_AGENT_LABEL_FONT_MAX_PX, Math.max(MONITOR_AGENT_LABEL_FONT_MIN_PX, rounded))
}

function stateTextColor(state: MonitorAgentView['state']): string {
  if (state === 'running' || state === 'thinking') return '#74d680'
  if (state === 'error') return '#ff6b6b'
  if (state === 'waiting') return '#ffd166'
  return '#ffffff'
}

export function MonitorDashboard({ snapshot, agentLabelFontPx }: MonitorDashboardProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  if (!snapshot) {
    return null
  }

  const baseFontPx = clampLabelFontPx(agentLabelFontPx)
  const titleFontPx = Math.max(16, baseFontPx - 2)
  const bodyFontPx = Math.max(14, baseFontPx - 4)
  const tinyFontPx = Math.max(13, baseFontPx - 5)
  const buttonFontPx = Math.max(13, baseFontPx - 5)

  const selected = snapshot.agents.find((a) => a.key === selectedKey) || null

  return (
    <div style={panelStyle}>
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--pixel-border)' }}>
        <div style={sectionTitleStyle}>Monitor</div>
        <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>
          total {snapshot.summary.total} | active {snapshot.summary.active} | waiting {snapshot.summary.waiting} | done {snapshot.summary.done} | error {snapshot.summary.error}
        </div>
        <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>
          pr pending {snapshot.summary.pr_pending} | alerts {snapshot.summary.alerts}
        </div>
      </div>
      <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {snapshot.agents.slice(0, 20).map((agent) => (
          <MonitorAgentCard
            key={agent.key}
            agent={agent}
            selected={selectedKey === agent.key}
            onSelect={() => setSelectedKey(agent.key)}
            titleFontPx={titleFontPx}
            bodyFontPx={bodyFontPx}
            buttonFontPx={buttonFontPx}
          />
        ))}
      </div>
      {selected && <MonitorDetail agent={selected} bodyFontPx={bodyFontPx} tinyFontPx={tinyFontPx} />}
    </div>
  )
}

function MonitorAgentCard({
  agent,
  selected,
  onSelect,
  titleFontPx,
  bodyFontPx,
  buttonFontPx,
}: {
  agent: MonitorAgentView
  selected: boolean
  onSelect: () => void
  titleFontPx: number
  bodyFontPx: number
  buttonFontPx: number
}) {
  const head = `${agent.display_name} (${agent.state})`
  const titleColor = stateTextColor(agent.state)
  return (
    <div style={{ border: selected ? '1px solid var(--pixel-accent)' : '1px solid var(--pixel-border)', padding: '5px 6px', cursor: 'pointer' }} onClick={onSelect}>
      <div style={{ fontSize: `${titleFontPx}px`, color: titleColor }}>{head}</div>
      <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>{agent.last_text || 'No recent text'}</div>
      <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>{agent.repo_path || 'Repo not bound'}</div>
      {agent.git && (
        <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>
          git {agent.git.branch || 'unknown'} | {agent.git.dirty ? 'dirty' : 'clean'}
        </div>
      )}
      {agent.pr && (
        <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>
          pr {agent.pr.has_open_pr ? agent.pr.state || 'OPEN' : 'none'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button
          style={{ ...actionBtn, fontSize: `${buttonFontPx}px` }}
          onClick={() => {
            if (agent.repo_path) {
              vscode.postMessage({ type: 'monitorOpenRepo', repoPath: agent.repo_path })
            } else {
              vscode.postMessage({ type: 'monitorChooseRepo', source: agent.source, sessionId: agent.session_id })
            }
          }}
        >
          {agent.repo_path ? 'Open Repo' : 'Bind Repo'}
        </button>
        <button
          style={{ ...actionBtn, fontSize: `${buttonFontPx}px` }}
          onClick={() => {
            vscode.postMessage({ type: 'monitorCopyText', text: agent.session_id })
          }}
        >
          Copy Session
        </button>
        <button
          style={{ ...actionBtn, fontSize: `${buttonFontPx}px` }}
          onClick={() => {
            vscode.postMessage({ type: 'monitorRevealTerminal', sessionId: agent.session_id, repoPath: agent.repo_path || '' })
          }}
        >
          Reveal Terminal
        </button>
        <button
          style={{ ...actionBtn, fontSize: `${buttonFontPx}px` }}
          onClick={() => {
            const cmd = agent.source === 'opencode'
              ? `opencode resume ${agent.session_id}`
              : agent.source === 'codex'
                ? `codex resume ${agent.session_id}`
                : `claude --resume ${agent.session_id}`
            vscode.postMessage({ type: 'monitorCopyText', text: cmd })
          }}
        >
          Copy Resume
        </button>
      </div>
    </div>
  )
}

function MonitorDetail({ agent, bodyFontPx, tinyFontPx }: { agent: MonitorAgentView; bodyFontPx: number; tinyFontPx: number }) {
  return (
    <div style={{ borderTop: '1px solid var(--pixel-border)', padding: '6px 8px' }}>
      <div style={sectionTitleStyle}>Details</div>
      <div style={{ fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>source {agent.source} | session {agent.session_id}</div>
      {agent.files_touched.length > 0 && (
        <div style={{ marginTop: 4, fontSize: `${bodyFontPx}px`, color: 'var(--pixel-text-dim)' }}>
          files {agent.files_touched.slice(0, 10).join(', ')}
        </div>
      )}
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {agent.recent_events.slice(0, 20).map((event, index) => (
          <div key={`${event.ts_ms}:${index}`} style={{ fontSize: `${tinyFontPx}px`, color: 'var(--pixel-text-dim)' }}>
            {new Date(event.ts_ms).toLocaleTimeString()} | {event.type}/{event.state_hint} | {event.text || '-'}
          </div>
        ))}
      </div>
    </div>
  )
}
