import { useState, useEffect, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TileType } from '../office/types.js'
import type { FloorColor, OfficeLayout, PlacedFurniture, ToolActivity } from '../office/types.js'
import { extractToolName } from '../office/toolUtils.js'
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js'
import { buildDynamicCatalog, getCatalogEntry } from '../office/layout/furnitureCatalog.js'
import { setFloorSprites } from '../office/floorTiles.js'
import { setWallSprites } from '../office/wallTiles.js'
import { setCharacterTemplates } from '../office/sprites/spriteData.js'
import { isDesktopRuntime, vscode } from '../vscodeApi.js'
import { playDoneSound, setSoundEnabled } from '../notificationSound.js'
import {
  CHARACTER_ASSET_COUNT,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  CHARACTER_FRAMES_PER_DIRECTION,
  DEMO_WORK_ITEMS,
  MONITOR_AGENT_ID_BASE,
  MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
  MONITOR_AGENT_LABEL_FONT_MAX_PX,
  MONITOR_AGENT_LABEL_FONT_MIN_PX,
  MONITOR_CHARACTER_LIMIT,
} from '../constants.js'

export interface SubagentCharacter {
  id: number
  parentAgentId: number
  parentToolId: string
  label: string
}

export interface FurnitureAsset {
  id: string
  name: string
  label: string
  category: string
  file: string
  width: number
  height: number
  footprintW: number
  footprintH: number
  isDesk: boolean
  canPlaceOnWalls: boolean
  partOfGroup?: boolean
  groupId?: string
  canPlaceOnSurfaces?: boolean
  backgroundTiles?: number
}

export interface ExtensionMessageState {
  agents: number[]
  selectedAgent: number | null
  agentTools: Record<number, ToolActivity[]>
  agentStatuses: Record<number, string>
  subagentTools: Record<number, Record<string, ToolActivity[]>>
  subagentCharacters: SubagentCharacter[]
  layoutReady: boolean
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> }
  monitorSnapshot: MonitorSnapshot | null
  monitorToasts: MonitorToast[]
  dismissMonitorToast: (id: string) => void
  monitorSettings: MonitorSettings
  updateMonitorSettings: (settings: MonitorSettings) => void
  demoMode: boolean
  updateDemoMode: (enabled: boolean) => void
  claudeAvailable: boolean
  monitorCharacterIds: number[]
  monitorActivityById: Record<number, { state: MonitorAgentView['state']; text: string }>
}

export interface MonitorSettings {
  enabled: boolean
  enableClaude: boolean
  enableOpencode: boolean
  enableCodex: boolean
  enableGit: boolean
  enablePr: boolean
  flushIntervalMs: number
  sourcePollIntervalMs: number
  gitPollIntervalMs: number
  prPollIntervalMs: number
  agentLabelFontPx: number
  maxIdleAgents: number
}

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  enabled: true,
  enableClaude: true,
  enableOpencode: true,
  enableCodex: true,
  enableGit: true,
  enablePr: true,
  flushIntervalMs: 1000,
  sourcePollIntervalMs: 2000,
  gitPollIntervalMs: 20000,
  prPollIntervalMs: 90000,
  agentLabelFontPx: MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
  maxIdleAgents: 3,
}

function normalizeMonitorSettings(settings: Partial<MonitorSettings> | MonitorSettings): MonitorSettings {
  const fontRaw = Number(settings.agentLabelFontPx)
  const rounded = Number.isFinite(fontRaw) ? Math.round(fontRaw) : MONITOR_AGENT_LABEL_FONT_DEFAULT_PX
  const clamped = Math.min(MONITOR_AGENT_LABEL_FONT_MAX_PX, Math.max(MONITOR_AGENT_LABEL_FONT_MIN_PX, rounded))
  const idleRaw = Number(settings.maxIdleAgents)
  const idleRounded = Number.isFinite(idleRaw) ? Math.round(idleRaw) : DEFAULT_MONITOR_SETTINGS.maxIdleAgents
  const maxIdleAgents = Math.min(MONITOR_CHARACTER_LIMIT, Math.max(0, idleRounded))
  return {
    ...DEFAULT_MONITOR_SETTINGS,
    ...settings,
    agentLabelFontPx: clamped,
    maxIdleAgents,
  }
}

export interface MonitorNotification {
  title: string
  message: string
  kind: 'done' | 'error'
  key: string
}

export interface MonitorToast extends MonitorNotification {
  id: string
  createdAt: number
}

export interface MonitorAlert {
  kind: 'error' | 'pr-pending' | 'dirty'
  message: string
  ts_ms: number
}

export interface MonitorGitState {
  branch?: string
  dirty: boolean
  ahead?: number
  behind?: number
  last_checked_ms: number
  error?: string
}

export interface MonitorPrState {
  available: boolean
  has_open_pr: boolean
  title?: string
  url?: string
  state?: string
  merge_state_status?: string
  review_decision?: string
  last_checked_ms: number
  error?: string
}

export interface MonitorEventView {
  ts_ms: number
  type: 'message' | 'tool' | 'cmd' | 'error' | 'status'
  state_hint: 'idle' | 'thinking' | 'running' | 'waiting' | 'done' | 'error'
  text?: string
  files_touched?: string[]
}

export interface MonitorAgentView {
  key: string
  source: 'claude' | 'opencode' | 'codex'
  session_id: string
  agent_id: string
  display_name: string
  state: 'idle' | 'thinking' | 'running' | 'waiting' | 'done' | 'error'
  last_ts_ms: number
  last_text?: string
  repo_path?: string
  files_touched: string[]
  alerts: MonitorAlert[]
  recent_events: MonitorEventView[]
  git?: MonitorGitState
  pr?: MonitorPrState
}

export interface MonitorSummary {
  total: number
  active: number
  waiting: number
  done: number
  error: number
  pr_pending: number
  alerts: number
}

export interface MonitorSnapshot {
  summary: MonitorSummary
  agents: MonitorAgentView[]
  now_ms: number
}

function isSourceEnabled(agent: MonitorAgentView, settings: MonitorSettings): boolean {
  if (agent.source === 'claude') {
    return settings.enableClaude
  }
  if (agent.source === 'opencode') {
    return settings.enableOpencode
  }
  if (agent.source === 'codex') {
    return settings.enableCodex
  }
  return true
}

function normalizeMonitorSource(
  source: string,
  key: string,
): MonitorAgentView['source'] {
  const normalized = source.trim().toLowerCase()
  if (
    normalized === 'claude'
    || normalized === 'claudecode'
    || normalized === 'claude code'
    || normalized === 'claude-code'
    || key.startsWith('claude:')
  ) {
    return 'claude'
  }
  if (
    normalized === 'opencode'
    || normalized === 'open'
    || normalized === 'open-code'
    || normalized === 'open_code'
    || key.startsWith('opencode:')
  ) {
    return 'opencode'
  }
  return 'codex'
}

function normalizeMonitorSnapshot(snapshot: MonitorSnapshot, settings: MonitorSettings): MonitorSnapshot {
  const sortedAgents = snapshot.agents
    .map((agent) => ({
      ...agent,
      source: normalizeMonitorSource(String(agent.source), agent.key),
    }))
    .filter((agent) => isSourceEnabled(agent, settings))
    .sort((a, b) => b.last_ts_ms - a.last_ts_ms)

  const idleAgents = sortedAgents.filter((agent) => agent.state === 'idle')
  const nonIdleAgents = sortedAgents.filter((agent) => agent.state !== 'idle')
  const agents = [...nonIdleAgents, ...idleAgents.slice(0, settings.maxIdleAgents)]

  const summary: MonitorSummary = {
    total: agents.length,
    active: agents.filter((agent) => agent.state === 'running' || agent.state === 'thinking').length,
    waiting: agents.filter((agent) => agent.state === 'waiting').length,
    done: agents.filter((agent) => agent.state === 'done').length,
    error: agents.filter((agent) => agent.state === 'error').length,
    pr_pending: agents.filter((agent) => agent.pr?.has_open_pr).length,
    alerts: agents.reduce((sum, agent) => sum + agent.alerts.length, 0),
  }

  return {
    ...snapshot,
    summary,
    agents,
  }
}

interface LoadedCharacterData {
  down: string[][][]
  up: string[][][]
  right: string[][][]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase()
}

async function loadDesktopCharacterSprites(): Promise<LoadedCharacterData[] | null> {
  if (typeof document === 'undefined') {
    return null
  }
  const characters: LoadedCharacterData[] = []
  for (let ci = 0; ci < CHARACTER_ASSET_COUNT; ci++) {
    const img = await loadImage(`/assets/characters/char_${ci}.png`)
    if (
      img.width < CHARACTER_FRAME_WIDTH * CHARACTER_FRAMES_PER_DIRECTION
      || img.height < CHARACTER_FRAME_HEIGHT * 3
    ) {
      return null
    }
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return null
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const parsed: LoadedCharacterData = { down: [], up: [], right: [] }
    for (let dir = 0; dir < 3; dir++) {
      const dirKey = dir === 0 ? 'down' : dir === 1 ? 'up' : 'right'
      const rowOffset = dir * CHARACTER_FRAME_HEIGHT
      for (let frame = 0; frame < CHARACTER_FRAMES_PER_DIRECTION; frame++) {
        const colOffset = frame * CHARACTER_FRAME_WIDTH
        const sprite: string[][] = []
        for (let y = 0; y < CHARACTER_FRAME_HEIGHT; y++) {
          const row: string[] = []
          for (let x = 0; x < CHARACTER_FRAME_WIDTH; x++) {
            const pixel = ((rowOffset + y) * imageData.width + (colOffset + x)) * 4
            const r = imageData.data[pixel]
            const g = imageData.data[pixel + 1]
            const b = imageData.data[pixel + 2]
            const a = imageData.data[pixel + 3]
            row.push(a < 128 ? '' : `#${toHex(r)}${toHex(g)}${toHex(b)}`)
          }
          sprite.push(row)
        }
        parsed[dirKey].push(sprite)
      }
    }
    characters.push(parsed)
  }
  return characters
}

async function loadDesktopFurnitureAssets(): Promise<{ catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | null> {
  try {
    const response = await fetch('/assets/furniture/furniture-catalog.json', { cache: 'no-store' })
    if (!response.ok) {
      return null
    }
    const payload = await response.json() as { assets?: FurnitureAsset[] }
    const catalog = Array.isArray(payload.assets) ? payload.assets : []
    if (catalog.length === 0 || typeof document === 'undefined') {
      return null
    }

    const sprites: Record<string, string[][]> = {}
    for (const asset of catalog) {
      const rawFile = typeof asset.file === 'string' ? asset.file : ''
      if (!rawFile || !asset.id) {
        continue
      }
      const normalizedFile = rawFile.replace(/^\/+/, '')
      const filePath = normalizedFile.startsWith('assets/') ? `/${normalizedFile}` : `/assets/${normalizedFile}`
      const img = await loadImage(filePath)
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        continue
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const sprite: string[][] = []
      for (let y = 0; y < imageData.height; y++) {
        const row: string[] = []
        for (let x = 0; x < imageData.width; x++) {
          const pixel = (y * imageData.width + x) * 4
          const r = imageData.data[pixel]
          const g = imageData.data[pixel + 1]
          const b = imageData.data[pixel + 2]
          const a = imageData.data[pixel + 3]
          row.push(a < 128 ? '' : `#${toHex(r)}${toHex(g)}${toHex(b)}`)
        }
        sprite.push(row)
      }
      sprites[asset.id] = sprite
    }

    const filteredCatalog = catalog.filter((asset) => Boolean(sprites[asset.id]))
    if (filteredCatalog.length === 0) {
      return null
    }
    return { catalog: filteredCatalog, sprites }
  } catch {
    return null
  }
}

function saveAgentSeats(os: OfficeState, skipAgentIds?: Set<number>): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {}
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue
    if (skipAgentIds?.has(ch.id)) continue
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId }
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats })
}

const FALLBACK_OFFICE_FURNITURE: PlacedFurniture[] = [
  { uid: 'f-fb-01', type: 'whiteboard', col: 2, row: 1 },
  { uid: 'f-fb-02', type: 'bookshelf', col: 1, row: 2 },
  { uid: 'f-fb-03', type: 'bookshelf', col: 18, row: 2 },
  { uid: 'f-fb-04', type: 'cooler', col: 19, row: 2 },
  { uid: 'f-fb-05', type: 'desk', col: 3, row: 3 },
  { uid: 'f-fb-06', type: 'chair', col: 3, row: 5 },
  { uid: 'f-fb-07', type: 'desk', col: 7, row: 3 },
  { uid: 'f-fb-08', type: 'chair', col: 7, row: 5 },
  { uid: 'f-fb-09', type: 'desk', col: 11, row: 3 },
  { uid: 'f-fb-10', type: 'chair', col: 11, row: 5 },
  { uid: 'f-fb-11', type: 'desk', col: 15, row: 3 },
  { uid: 'f-fb-12', type: 'chair', col: 15, row: 5 },
  { uid: 'f-fb-13', type: 'desk', col: 3, row: 8 },
  { uid: 'f-fb-14', type: 'chair', col: 3, row: 10 },
  { uid: 'f-fb-15', type: 'desk', col: 7, row: 8 },
  { uid: 'f-fb-16', type: 'chair', col: 7, row: 10 },
  { uid: 'f-fb-17', type: 'desk', col: 11, row: 8 },
  { uid: 'f-fb-18', type: 'chair', col: 11, row: 10 },
  { uid: 'f-fb-19', type: 'desk', col: 15, row: 8 },
  { uid: 'f-fb-20', type: 'chair', col: 15, row: 10 },
  { uid: 'f-fb-21', type: 'desk', col: 3, row: 14 },
  { uid: 'f-fb-22', type: 'chair', col: 3, row: 16 },
  { uid: 'f-fb-23', type: 'desk', col: 7, row: 14 },
  { uid: 'f-fb-24', type: 'chair', col: 7, row: 16 },
  { uid: 'f-fb-25', type: 'bookshelf', col: 18, row: 16 },
  { uid: 'f-fb-26', type: 'whiteboard', col: 14, row: 18 },
  { uid: 'f-fb-27', type: 'plant', col: 18, row: 14 },
  { uid: 'f-fb-28', type: 'lamp', col: 12, row: 18 },
  { uid: 'f-fb-29', type: 'cooler', col: 1, row: 18 },
]

const REMOVED_CENTER_FURNITURE_UIDS = new Set([
  'f-default-ops-01',
  'f-default-ops-02',
  'f-1770720603403-9vfr',
  'f-fb-09',
  'f-fb-10',
  'f-fb-17',
  'f-fb-18',
  'f-fb-pc-03',
  'f-fb-pc-07',
  'f-fb-coffee-02',
])

const DISCUSSION_DESK_FURNITURE: PlacedFurniture[] = [
  { uid: 'f-discuss-desk-01', type: 'desk', col: 9, row: 6 },
  { uid: 'f-discuss-desk-02', type: 'desk', col: 10, row: 6 },
  { uid: 'f-discuss-desk-03', type: 'desk', col: 11, row: 6 },
  { uid: 'f-discuss-desk-04', type: 'desk', col: 12, row: 6 },
  { uid: 'f-discuss-desk-05', type: 'desk', col: 9, row: 8 },
  { uid: 'f-discuss-desk-06', type: 'desk', col: 10, row: 8 },
  { uid: 'f-discuss-desk-07', type: 'desk', col: 11, row: 8 },
  { uid: 'f-discuss-desk-08', type: 'desk', col: 12, row: 8 },
  { uid: 'f-discuss-chair-01', type: 'chair', col: 9, row: 5 },
  { uid: 'f-discuss-chair-02', type: 'chair', col: 10, row: 5 },
  { uid: 'f-discuss-chair-03', type: 'chair', col: 11, row: 5 },
  { uid: 'f-discuss-chair-04', type: 'chair', col: 12, row: 5 },
  { uid: 'f-discuss-chair-05', type: 'chair', col: 9, row: 9 },
  { uid: 'f-discuss-chair-06', type: 'chair', col: 10, row: 9 },
  { uid: 'f-discuss-chair-07', type: 'chair', col: 11, row: 9 },
  { uid: 'f-discuss-chair-08', type: 'chair', col: 12, row: 9 },
]

function ensureLayoutHasRenderableFurniture(layout: OfficeLayout): { layout: OfficeLayout; changed: boolean } {
  const hasRenderable = layout.furniture.some((item) => Boolean(getCatalogEntry(item.type)))
  if (hasRenderable) {
    return { layout, changed: false }
  }
  const existing = new Set(layout.furniture.map((item) => item.uid))
  const additions = FALLBACK_OFFICE_FURNITURE.filter((item) => !existing.has(item.uid))
  if (additions.length === 0) {
    return { layout, changed: false }
  }
  return { layout: { ...layout, furniture: [...layout.furniture, ...additions] }, changed: true }
}

function removeCenterDeskCluster(layout: OfficeLayout): { layout: OfficeLayout; changed: boolean } {
  const nextFurniture = layout.furniture.filter((item) => !REMOVED_CENTER_FURNITURE_UIDS.has(item.uid))
  if (nextFurniture.length === layout.furniture.length) {
    return { layout, changed: false }
  }
  return { layout: { ...layout, furniture: nextFurniture }, changed: true }
}

function ensureCenterDiscussionDesk(
  layout: OfficeLayout,
  shouldMigrateLegacyCenter: boolean,
): { layout: OfficeLayout; changed: boolean } {
  if (!shouldMigrateLegacyCenter) {
    return { layout, changed: false }
  }
  const existing = new Set(layout.furniture.map((item) => item.uid))
  const additions = DISCUSSION_DESK_FURNITURE.filter((item) => !existing.has(item.uid))
  if (additions.length === 0) {
    return { layout, changed: false }
  }
  return { layout: { ...layout, furniture: [...layout.furniture, ...additions] }, changed: true }
}

function openTopHalfAsSingleRoom(layout: OfficeLayout): { layout: OfficeLayout; changed: boolean } {
  const hasDefaultMarkers = layout.furniture.some(
    (item) => item.uid.startsWith('f-default-ops-') || item.uid.startsWith('f-fb-'),
  )
  if (!hasDefaultMarkers) {
    return { layout, changed: false }
  }
  const cols = layout.cols
  const rows = layout.rows
  if (cols < 3 || rows < 3) {
    return { layout, changed: false }
  }
  const topMaxRow = Math.max(1, Math.floor(rows / 2) - 1)
  type LayoutTile = OfficeLayout['tiles'][number]
  const nextTiles = [...layout.tiles]
  const nextTileColors = layout.tileColors ? [...layout.tileColors] : null
  const floorTypes = new Set<LayoutTile>([
    TileType.FLOOR_1,
    TileType.FLOOR_2,
    TileType.FLOOR_3,
    TileType.FLOOR_4,
    TileType.FLOOR_5,
    TileType.FLOOR_6,
    TileType.FLOOR_7,
  ])

  const indexOf = (row: number, col: number): number => row * cols + col
  const resolveFloor = (row: number, col: number): { tile: LayoutTile; color: FloorColor | null } | null => {
    const neighbors: Array<[number, number]> = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ]
    const floorNeighbors: Array<{ tile: LayoutTile; color: FloorColor | null }> = []
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const nIndex = indexOf(nr, nc)
      const nTile = nextTiles[nIndex]
      if (!floorTypes.has(nTile)) continue
      floorNeighbors.push({ tile: nTile, color: nextTileColors ? nextTileColors[nIndex] : null })
    }
    if (floorNeighbors.length === 0) {
      return null
    }
    const best = floorNeighbors[0]
    return {
      tile: best.tile,
      color: best.color ?? { h: 0, s: 0, b: 0, c: 0 },
    }
  }

  let changed = false
  for (let pass = 0; pass < 3; pass++) {
    let passChanged = false
    for (let row = 1; row <= topMaxRow; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const idx = indexOf(row, col)
        if (nextTiles[idx] !== TileType.WALL) continue
        const replacement = resolveFloor(row, col)
        if (!replacement) continue
        nextTiles[idx] = replacement.tile
        if (nextTileColors) {
          nextTileColors[idx] = replacement.color
        }
        passChanged = true
        changed = true
      }
    }
    if (!passChanged) {
      break
    }
  }

  if (!changed) {
    return { layout, changed: false }
  }
  return {
    layout: {
      ...layout,
      tiles: nextTiles,
      tileColors: nextTileColors ?? layout.tileColors,
    },
    changed: true,
  }
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({})
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({})
  const [subagentTools, setSubagentTools] = useState<Record<number, Record<string, ToolActivity[]>>>({})
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([])
  const [layoutReady, setLayoutReady] = useState(false)
  const [loadedAssets, setLoadedAssets] = useState<{ catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined>()
  const [monitorSnapshot, setMonitorSnapshot] = useState<MonitorSnapshot | null>(null)
  const [monitorToasts, setMonitorToasts] = useState<MonitorToast[]>([])
  const [monitorSettings, setMonitorSettings] = useState<MonitorSettings>(DEFAULT_MONITOR_SETTINGS)
  const [demoMode, setDemoMode] = useState(false)
  const [claudeAvailable, setClaudeAvailable] = useState(true)
  const [monitorCharacterIds, setMonitorCharacterIds] = useState<number[]>([])
  const [monitorActivityById, setMonitorActivityById] = useState<Record<number, { state: MonitorAgentView['state']; text: string }>>({})
  const monitorIdByKeyRef = useRef<Map<string, number>>(new Map())
  const monitorIdsRef = useRef<Set<number>>(new Set())
  const nextMonitorIdRef = useRef(MONITOR_AGENT_ID_BASE)
  const monitorSettingsRef = useRef<MonitorSettings>(monitorSettings)
  const demoModeRef = useRef(demoMode)
  const demoSyntheticSubagentsRef = useRef<Array<{ parentAgentId: number; parentToolId: string }>>([])
  const demoForcedAgentIdsRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    monitorSettingsRef.current = monitorSettings
  }, [monitorSettings])

  useEffect(() => {
    demoModeRef.current = demoMode
  }, [demoMode])

  const shouldForceDemoForAgent = (id: number): boolean => id > 0 && demoModeRef.current

  const demoWorkTextForId = (id: number, offset = 0): string => {
    const index = Math.abs(id + offset) % DEMO_WORK_ITEMS.length
    return DEMO_WORK_ITEMS[index]
  }

  const setAgentVisualState = (os: OfficeState, id: number, active: boolean): void => {
    if (shouldForceDemoForAgent(id)) {
      os.setAgentActive(id, true)
      os.setAgentTool(id, demoWorkTextForId(id))
      return
    }
    os.setAgentActive(id, active)
  }

  const clearAgentTool = (os: OfficeState, id: number): void => {
    if (shouldForceDemoForAgent(id)) {
      os.setAgentTool(id, demoWorkTextForId(id))
      return
    }
    os.setAgentTool(id, null)
  }

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false)

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: Array<{ id: number; palette?: number; hueShift?: number; seatId?: string }> = []
    let disposed = false

    const handler = (e: MessageEvent) => {
      if (disposed) {
        return
      }
      const msg = e.data
      const os = getOfficeState()

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes')
          return
      }
      const rawLayout = msg.layout as OfficeLayout | null
      let layoutAdjusted = false
      const layout = rawLayout && rawLayout.version === 1
          ? (() => {
              const migrated = migrateLayoutColors(rawLayout)
              const shouldMigrateLegacyCenter = migrated.furniture.some((item) => REMOVED_CENTER_FURNITURE_UIDS.has(item.uid))
              const ensured = ensureLayoutHasRenderableFurniture(migrated)
              const cleaned = removeCenterDeskCluster(ensured.layout)
              const discussion = ensureCenterDiscussionDesk(cleaned.layout, shouldMigrateLegacyCenter)
              const opened = openTopHalfAsSingleRoom(discussion.layout)
              layoutAdjusted = ensured.changed || cleaned.changed || discussion.changed || opened.changed
              return opened.layout
            })()
          : null
        if (layout) {
          os.rebuildFromLayout(layout)
          onLayoutLoaded?.(layout)
          if (layoutAdjusted) {
            vscode.postMessage({ type: 'saveLayout', layout })
          }
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout())
        }
        // Add buffered agents now that layout (and seats) are correct
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true)
        }
        pendingAgents = []
        layoutReadyRef.current = true
        setLayoutReady(true)
        if (os.characters.size > 0) {
          saveAgentSeats(os, monitorIdsRef.current)
        }
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]))
        setSelectedAgent(id)
        os.addAgent(id)
        saveAgentSeats(os, monitorIdsRef.current)
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number
        setAgents((prev) => prev.filter((a) => a !== id))
        setSelectedAgent((prev) => (prev === id ? null : prev))
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id)
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id))
        os.removeAgent(id)
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[]
        const meta = (msg.agentMeta || {}) as Record<number, { palette?: number; hueShift?: number; seatId?: string }>
        // Buffer agents — they'll be added in layoutLoaded after seats are built
        for (const id of incoming) {
          const m = meta[id]
          pendingAgents.push({ id, palette: m?.palette, hueShift: m?.hueShift, seatId: m?.seatId })
        }
        setAgents((prev) => {
          const ids = new Set(prev)
          const merged = [...prev]
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id)
            }
          }
          return merged.sort((a, b) => a - b)
        })
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        const status = msg.status as string
        setAgentTools((prev) => {
          const list = prev[id] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: [...list, { toolId, status, done: false }] }
        })
        const toolName = extractToolName(status)
        os.setAgentTool(id, toolName)
        setAgentVisualState(os, id, true)
        os.clearPermissionBubble(id)
        // Create sub-agent character for Task tool subtasks
        if (status.startsWith('Subtask:')) {
          const label = status.slice('Subtask:'.length).trim()
          const subId = os.addSubagent(id, toolId)
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === subId)) return prev
            return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }]
          })
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          }
        })
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id)
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id))
        clearAgentTool(os, id)
        os.clearPermissionBubble(id)
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number
        setSelectedAgent(id)
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number
        const status = msg.status as string
        const forceDemo = shouldForceDemoForAgent(id)
        setAgentStatuses((prev) => {
          if (forceDemo) {
            if (!(id in prev)) return prev
            const next = { ...prev }
            delete next[id]
            return next
          }
          if (status === 'active') {
            if (!(id in prev)) return prev
            const next = { ...prev }
            delete next[id]
            return next
          }
          return { ...prev, [id]: status }
        })
        setAgentVisualState(os, id, status === 'active')
        if (status === 'waiting') {
          os.showWaitingBubble(id)
          playDoneSound()
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          }
        })
        os.showPermissionBubble(id)
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        // Show permission bubble on the sub-agent character
        const subId = os.getSubagentId(id, parentToolId)
        if (subId !== null) {
          os.showPermissionBubble(subId)
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          const hasPermission = list.some((t) => t.permissionWait)
          if (!hasPermission) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          }
        })
        os.clearPermissionBubble(id)
        // Also clear permission bubbles on all sub-agent characters of this parent
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId)
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        const status = msg.status as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {}
          const list = agentSubs[parentToolId] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] } }
        })
        // Update sub-agent character's tool and active state
        const subId = os.getSubagentId(id, parentToolId)
        if (subId !== null) {
          const subToolName = extractToolName(status)
          os.setAgentTool(subId, subToolName)
          os.setAgentActive(subId, true)
        }
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs) return prev
          const list = agentSubs[parentToolId]
          if (!list) return prev
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)) },
          }
        })
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        setSubagentTools((prev) => {
          const agentSubs = prev[id]
          if (!agentSubs || !(parentToolId in agentSubs)) return prev
          const next = { ...agentSubs }
          delete next[parentToolId]
          if (Object.keys(next).length === 0) {
            const outer = { ...prev }
            delete outer[id]
            return outer
          }
          return { ...prev, [id]: next }
        })
        // Remove sub-agent character
        os.removeSubagent(id, parentToolId)
        setSubagentCharacters((prev) => prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)))
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{ down: string[][][]; up: string[][][]; right: string[][][] }>
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`)
        setCharacterTemplates(characters)
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][]
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`)
        setFloorSprites(sprites)
      } else if (msg.type === 'wallTilesLoaded') {
        const sprites = msg.sprites as string[][][]
        console.log(`[Webview] Received ${sprites.length} wall tile sprites`)
        setWallSprites(sprites)
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean
        setSoundEnabled(soundOn)
        setDemoMode(Boolean(msg.demoMode))
        const incoming = msg.monitorSettings as Partial<MonitorSettings> | undefined
        if (incoming) {
          const normalized = normalizeMonitorSettings(incoming)
          setMonitorSettings(normalized)
          monitorSettingsRef.current = normalized
          setMonitorSnapshot((prev) => (prev ? normalizeMonitorSnapshot(prev, normalized) : prev))
        }
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[]
          const sprites = msg.sprites as Record<string, string[][]>
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`)
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites })
          setLoadedAssets({ catalog, sprites })
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err)
        }
      } else if (msg.type === 'monitorStateUpdate') {
        const rawSnapshot = msg.snapshot as MonitorSnapshot
        const snapshot = normalizeMonitorSnapshot(rawSnapshot, monitorSettingsRef.current)
        setMonitorSnapshot(snapshot)

        const previousMonitorIds = new Set(monitorIdsRef.current)
        const nextMonitorIds = new Set<number>()
        const visibleAgents = snapshot.agents.slice(0, MONITOR_CHARACTER_LIMIT)

        for (const monitorAgent of visibleAgents) {
          let id = monitorIdByKeyRef.current.get(monitorAgent.key)
          if (!id) {
            id = nextMonitorIdRef.current++
            monitorIdByKeyRef.current.set(monitorAgent.key, id)
          }
          nextMonitorIds.add(id)

          if (!os.characters.has(id)) {
            os.addAgent(id)
          }

          const state = monitorAgent.state
          const isActive = state === 'running' || state === 'thinking'
          setAgentVisualState(os, id, isActive)

          if (isActive) {
            os.setAgentTool(id, 'Task')
            os.clearPermissionBubble(id)
          } else {
            clearAgentTool(os, id)
            if (state === 'waiting') {
              os.showWaitingBubble(id)
            }
            if (state === 'error') {
              os.showPermissionBubble(id)
            }
          }
        }

        for (const oldId of previousMonitorIds) {
          if (!nextMonitorIds.has(oldId)) {
            os.removeAgent(oldId)
          }
        }

        const nextActivity: Record<number, { state: MonitorAgentView['state']; text: string }> = {}
        for (const monitorAgent of visibleAgents) {
          const id = monitorIdByKeyRef.current.get(monitorAgent.key)
          if (!id) continue
          const stateText = monitorAgent.state
          const tail = monitorAgent.last_text ? ` ${monitorAgent.last_text}` : ''
          nextActivity[id] = {
            state: monitorAgent.state,
            text: `${monitorAgent.display_name} ${stateText}${tail}`,
          }
        }
        setMonitorActivityById(nextActivity)

        monitorIdsRef.current = nextMonitorIds
        setMonitorCharacterIds([...nextMonitorIds].sort((a, b) => a - b))

        setAgents((prev) => {
          const base = prev.filter((id) => !previousMonitorIds.has(id))
          return [...base, ...nextMonitorIds].sort((a, b) => a - b)
        })

        setAgentStatuses((prev) => {
          const next = { ...prev }
          for (const oldId of previousMonitorIds) {
            if (!nextMonitorIds.has(oldId) && oldId in next) {
              delete next[oldId]
            }
          }
          for (const monitorAgent of visibleAgents) {
            const id = monitorIdByKeyRef.current.get(monitorAgent.key)
            if (!id) continue
            if (monitorAgent.state === 'running' || monitorAgent.state === 'thinking') {
              if (id in next) {
                delete next[id]
              }
            } else {
              next[id] = monitorAgent.state
            }
          }
          return next
        })
      } else if (msg.type === 'monitorNotification') {
        const notification = msg.notification as MonitorNotification
        const toast: MonitorToast = {
          ...notification,
          id: `${notification.key}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        }
        setMonitorToasts((prev) => [toast, ...prev].slice(0, 6))
        if (notification.kind === 'done') {
          playDoneSound()
        }
      } else if (msg.type === 'agentLauncherStatus') {
        setClaudeAvailable(Boolean(msg.claudeAvailable))
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'webviewReady' })
    if (isDesktopRuntime) {
      void Promise.all([loadDesktopCharacterSprites(), loadDesktopFurnitureAssets()])
        .then(([characters, furnitureAssets]) => {
          if (disposed) {
            return
          }
          if (characters) {
            setCharacterTemplates(characters)
          }
          if (furnitureAssets) {
            buildDynamicCatalog(furnitureAssets)
            setLoadedAssets(furnitureAssets)
          }
        })
        .catch((err) => {
          console.error('[Webview] Failed to bootstrap desktop assets:', err)
        })
    }
    return () => {
      disposed = true
      window.removeEventListener('message', handler)
    }
  }, [getOfficeState])

  const dismissMonitorToast = (id: string): void => {
    setMonitorToasts((prev) => prev.filter((t) => t.id !== id))
  }

  const updateMonitorSettings = (settings: MonitorSettings): void => {
    const normalized = normalizeMonitorSettings(settings)
    setMonitorSettings(normalized)
    monitorSettingsRef.current = normalized
    setMonitorSnapshot((prev) => (prev ? normalizeMonitorSnapshot(prev, normalized) : prev))
    vscode.postMessage({ type: 'setMonitorSettings', settings: normalized })
  }

  const updateDemoMode = (enabled: boolean): void => {
    const normalized = Boolean(enabled)
    setDemoMode(normalized)
    vscode.postMessage({ type: 'setDemoMode', enabled: normalized })
  }

  useEffect(() => {
    const os = getOfficeState()

    if (!demoMode) {
      const demoSubs = demoSyntheticSubagentsRef.current
      if (demoSubs.length > 0) {
        for (const sub of demoSubs) {
          os.removeSubagent(sub.parentAgentId, sub.parentToolId)
        }
        const keys = new Set(demoSubs.map((sub) => `${sub.parentAgentId}:${sub.parentToolId}`))
        setSubagentCharacters((prev) => prev.filter((sub) => !keys.has(`${sub.parentAgentId}:${sub.parentToolId}`)))
        demoSyntheticSubagentsRef.current = []
      }

      if (demoForcedAgentIdsRef.current.size > 0) {
        for (const id of demoForcedAgentIdsRef.current) {
          os.setAgentTool(id, null)
        }
        demoForcedAgentIdsRef.current.clear()
      }
      return
    }

    const baseAgents = os.getCharacters().filter((ch) => !ch.isSubagent)
    const forcedIds = demoForcedAgentIdsRef.current
    for (const ch of baseAgents) {
      if (ch.id <= 0) {
        continue
      }
      os.setAgentActive(ch.id, true)
      os.setAgentTool(ch.id, demoWorkTextForId(ch.id))
      forcedIds.add(ch.id)
    }

    const existing = new Set(demoSyntheticSubagentsRef.current.map((sub) => `${sub.parentAgentId}:${sub.parentToolId}`))
    const nextSubs = [...demoSyntheticSubagentsRef.current]
    for (const parent of baseAgents.filter((ch) => ch.id > 0).slice(0, 3)) {
      const parentToolId = `demo-discuss-${parent.id}`
      const key = `${parent.id}:${parentToolId}`
      if (existing.has(key)) {
        continue
      }
      const subId = os.addSubagent(parent.id, parentToolId)
      os.setAgentActive(subId, true)
      os.setAgentTool(subId, demoWorkTextForId(subId, 3))
      const label = demoWorkTextForId(subId, 7)
      nextSubs.push({ parentAgentId: parent.id, parentToolId })
      setSubagentCharacters((prev) => {
        if (prev.some((sub) => sub.id === subId)) {
          return prev
        }
        return [...prev, { id: subId, parentAgentId: parent.id, parentToolId, label }]
      })
    }
    demoSyntheticSubagentsRef.current = nextSubs
  }, [agents, demoMode, getOfficeState])

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    loadedAssets,
    monitorSnapshot,
    monitorToasts,
    dismissMonitorToast,
    monitorSettings,
    updateMonitorSettings,
    demoMode,
    updateDemoMode,
    claudeAvailable,
    monitorCharacterIds,
    monitorActivityById,
  }
}
