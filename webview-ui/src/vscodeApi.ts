type AnyRecord = Record<string, unknown>

import { invoke } from '@tauri-apps/api/core'

interface VsCodeApiLike {
  postMessage: (msg: unknown) => void
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApiLike
    __TAURI_INTERNALS__?: unknown
  }
}

const isTauriDesktop = typeof window !== 'undefined' && (
  window.location.protocol === 'tauri:'
  || window.location.hostname === 'tauri.localhost'
  || '__TAURI_INTERNALS__' in window
)

export const isDesktopRuntime = isTauriDesktop

let monitorTimer: number | null = null
let monitorTickErrored = false
let monitorTickInFlight = false

function emitMessageToApp(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }))
}

async function tauriInvoke<T>(command: string, args?: AnyRecord): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)
    throw new Error(`[Tauri:${command}] ${message}`)
  }
}

function reportTauriError(scope: string, error: unknown): void {
  if (error instanceof Error) {
    console.error(`[Desktop Bridge] ${scope}: ${error.message}`)
    return
  }
  console.error(`[Desktop Bridge] ${scope}:`, error)
}

async function startDesktopMonitorLoop(): Promise<void> {
  if (monitorTimer !== null) {
    return
  }
  const tick = async (): Promise<void> => {
    if (monitorTickInFlight) {
      return
    }
    monitorTickInFlight = true
    try {
      const payload = await tauriInvoke<{ snapshot: unknown; notifications: Array<{ title: string; message: string; kind: 'done' | 'error'; key: string }> }>('desktop_monitor_tick')
      monitorTickErrored = false
      emitMessageToApp({ type: 'monitorStateUpdate', snapshot: payload.snapshot })
      for (const notification of payload.notifications) {
        emitMessageToApp({ type: 'monitorNotification', notification })
      }
    } catch (error) {
      if (!monitorTickErrored) {
        monitorTickErrored = true
        reportTauriError('monitor tick failed', error)
      }
    } finally {
      monitorTickInFlight = false
    }
  }
  await tick()
  monitorTimer = window.setInterval(() => {
    void tick()
  }, 2000)
}

async function stopDesktopMonitorLoop(): Promise<void> {
  if (monitorTimer !== null) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
}

async function handleTauriMessage(msg: AnyRecord): Promise<void> {
  const type = typeof msg.type === 'string' ? msg.type : ''
  switch (type) {
    case 'webviewReady': {
      const bootstrap = await tauriInvoke<{
        layout: unknown
        soundEnabled: boolean
        demoMode: boolean
        monitorSettings: unknown
        claudeAvailable: boolean
      }>('desktop_bootstrap')
      emitMessageToApp({ type: 'layoutLoaded', layout: bootstrap.layout })
      emitMessageToApp({ type: 'settingsLoaded', soundEnabled: bootstrap.soundEnabled, demoMode: bootstrap.demoMode, monitorSettings: bootstrap.monitorSettings })
      emitMessageToApp({ type: 'agentLauncherStatus', claudeAvailable: bootstrap.claudeAvailable })
      emitMessageToApp({ type: 'existingAgents', agents: [] })
      await startDesktopMonitorLoop()
      return
    }
    case 'saveLayout': {
      await tauriInvoke('desktop_save_layout', { layout: msg.layout })
      return
    }
    case 'saveAgentSeats': {
      await tauriInvoke('desktop_save_agent_seats', { seats: msg.seats })
      return
    }
    case 'setSoundEnabled': {
      await tauriInvoke('desktop_set_sound_enabled', { enabled: msg.enabled })
      return
    }
    case 'setDemoMode': {
      await tauriInvoke('desktop_set_demo_mode', { enabled: Boolean(msg.enabled) })
      return
    }
    case 'setMonitorSettings': {
      await tauriInvoke('desktop_set_monitor_settings', { settings: msg.settings })
      return
    }
    case 'setPictureInPicture': {
      await tauriInvoke('desktop_set_picture_in_picture', { enabled: Boolean(msg.enabled) })
      return
    }
    case 'monitorBindRepo': {
      await tauriInvoke('desktop_bind_repo', {
        source: msg.source,
        sessionId: msg.sessionId,
        repoPath: msg.repoPath,
      })
      return
    }
    case 'monitorOpenRepo': {
      if (typeof msg.repoPath === 'string' && msg.repoPath.length > 0) {
        await tauriInvoke('desktop_open_path', { path: msg.repoPath })
      }
      return
    }
    case 'monitorChooseRepo': {
      const picked = await tauriInvoke<string | null>('desktop_choose_repo_folder')
      if (typeof picked === 'string' && typeof msg.source === 'string' && typeof msg.sessionId === 'string') {
        await tauriInvoke('desktop_bind_repo', {
          source: msg.source,
          sessionId: msg.sessionId,
          repoPath: picked,
        })
      }
      return
    }
    case 'monitorCopyText': {
      if (typeof msg.text === 'string') {
        await tauriInvoke('desktop_copy_text', { text: msg.text })
      }
      return
    }
    case 'monitorRevealTerminal': {
      if (typeof msg.repoPath === 'string' && msg.repoPath.length > 0) {
        await tauriInvoke('desktop_open_path', { path: msg.repoPath })
      }
      return
    }
    case 'openClaudeInstallDocs': {
      await tauriInvoke('desktop_open_url', { url: 'https://docs.anthropic.com/en/docs/claude-code' })
      return
    }
    case 'openAgent': {
      const source = typeof msg.source === 'string' ? msg.source : 'claude'
      try {
        const cwd = await tauriInvoke<string | null>('desktop_choose_repo_folder')
        if (!cwd) {
          return
        }
        await tauriInvoke('desktop_launch_agent', { source, cwd })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        emitMessageToApp({
          type: 'monitorNotification',
          notification: {
            title: 'Agent launch failed',
            message: `${source}: ${detail}`,
            kind: 'error',
            key: `launch:${source}`,
          },
        })
      }
      return
    }
    case 'openSessionsFolder': {
      const path = await tauriInvoke<string | null>('desktop_sessions_folder')
      if (path) {
        await tauriInvoke('desktop_open_path', { path })
      }
      return
    }
    case 'exportLayout': {
      await tauriInvoke('desktop_export_layout')
      return
    }
    case 'importLayout': {
      const layout = await tauriInvoke<unknown | null>('desktop_import_layout')
      if (layout) {
        emitMessageToApp({ type: 'layoutLoaded', layout })
      }
      return
    }
    case 'focusAgent':
    case 'openClaude':
    case 'closeAgent': {
      if (type === 'openClaude') {
        await tauriInvoke('desktop_launch_agent', { source: 'claude' })
      }
      return
    }
    default:
      return
  }
}

export const vscode: VsCodeApiLike = {
  postMessage(msg: unknown): void {
    if (!isTauriDesktop && typeof window.acquireVsCodeApi === 'function') {
      window.acquireVsCodeApi().postMessage(msg)
      return
    }
    if (isTauriDesktop && msg && typeof msg === 'object') {
      void handleTauriMessage(msg as AnyRecord).catch((error) => {
        reportTauriError('message handling failed', error)
      })
    }
  },
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    void stopDesktopMonitorLoop()
  })
}
