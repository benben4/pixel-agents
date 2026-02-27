import { useState, useCallback, useEffect, useRef } from 'react'
import { OfficeState } from './office/engine/officeState.js'
import { OfficeCanvas } from './office/components/OfficeCanvas.js'
import { ToolOverlay } from './office/components/ToolOverlay.js'
import { EditorToolbar } from './office/editor/EditorToolbar.js'
import { EditorState } from './office/editor/editorState.js'
import { EditTool } from './office/types.js'
import { isRotatable } from './office/layout/furnitureCatalog.js'
import { vscode } from './vscodeApi.js'
import { useExtensionMessages } from './hooks/useExtensionMessages.js'
import { MONITOR_AGENT_ID_BASE, PULSE_ANIMATION_DURATION_SEC } from './constants.js'
import { useEditorActions } from './hooks/useEditorActions.js'
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js'
import { ZoomControls } from './components/ZoomControls.js'
import { BottomToolbar } from './components/BottomToolbar.js'
import { DebugView } from './components/DebugView.js'
import { MonitorDashboard } from './components/MonitorDashboard.js'
import { MonitorToasts } from './components/MonitorToasts.js'
import { CharacterInfoBoard } from './components/CharacterInfoBoard.js'

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null }
const editorState = new EditorState()

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState()
  }
  return officeStateRef.current
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
}

function EditActionBar({ editor, editorState: es }: { editor: ReturnType<typeof useEditorActions>; editorState: EditorState }) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const undoDisabled = es.undoStack.length === 0
  const redoDisabled = es.redoStack.length === 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>
      <button
        style={actionBarBtnStyle}
        onClick={editor.handleSave}
        title="Save layout"
      >
        Save
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title="Reset to last saved layout"
        >
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => { setShowResetConfirm(false); editor.handleReset() }}
          >
            Yes
          </button>
          <button
            style={actionBarBtnStyle}
            onClick={() => setShowResetConfirm(false)}
          >
            No
          </button>
        </div>
      )}
    </div>
  )
}

function App() {
  const editor = useEditorActions(getOfficeState, editorState)

  const isEditDirty = useCallback(() => editor.isEditMode && editor.isDirty, [editor.isEditMode, editor.isDirty])

  const {
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
    monitorCharacterIds,
    monitorActivityById,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty)

  const [isDebugMode, setIsDebugMode] = useState(false)
  const [characterBoardAnchor, setCharacterBoardAnchor] = useState<{ x: number; y: number } | null>(null)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)
  const [pipFollowAgentId, setPipFollowAgentId] = useState<number | null>(null)

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), [])

  const handleSelectAgent = useCallback((id: number) => {
    if (id >= MONITOR_AGENT_ID_BASE) {
      return
    }
    vscode.postMessage({ type: 'focusAgent', id })
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0)
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  )

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id })
  }, [])

  const handleOpenAgent = useCallback((source: 'claude' | 'opencode' | 'codex') => {
    vscode.postMessage({ type: 'openAgent', source })
  }, [])

  const handleClick = useCallback((agentId: number, anchor: { x: number; y: number }) => {
    setCharacterBoardAnchor(anchor)
    if (agentId >= MONITOR_AGENT_ID_BASE) {
      return
    }
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState()
    const meta = os.subagentMeta.get(agentId)
    const focusId = meta ? meta.parentAgentId : agentId
    vscode.postMessage({ type: 'focusAgent', id: focusId })
  }, [])

  const officeState = getOfficeState()

  const pickPipAgent = useCallback((): number | null => {
    const activeCharacters = officeState
      .getCharacters()
      .filter((ch) => !ch.isSubagent && ch.isActive)
      .sort((a, b) => b.id - a.id)
    if (activeCharacters.length === 0) {
      return null
    }

    const selectedActive = selectedAgent === null || selectedAgent >= MONITOR_AGENT_ID_BASE
      ? null
      : activeCharacters.find((ch) => ch.id === selectedAgent)
    if (selectedActive) {
      return selectedActive.id
    }

    const primaryActive = activeCharacters.find((ch) => ch.id < MONITOR_AGENT_ID_BASE)
    if (primaryActive) {
      return primaryActive.id
    }

    const monitorActive = activeCharacters.find((ch) => {
      if (ch.id < MONITOR_AGENT_ID_BASE) {
        return false
      }
      const state = monitorActivityById[ch.id]?.state
      return state === 'running' || state === 'thinking'
    })
    if (monitorActive) {
      return monitorActive.id
    }

    return activeCharacters[0].id
  }, [monitorActivityById, officeState, selectedAgent])

  useEffect(() => {
    vscode.postMessage({ type: 'setPictureInPicture', enabled: isPictureInPicture })
  }, [isPictureInPicture])

  useEffect(() => {
    return () => {
      vscode.postMessage({ type: 'setPictureInPicture', enabled: false })
    }
  }, [])

  useEffect(() => {
    if (!isPictureInPicture) {
      if (pipFollowAgentId !== null && officeState.cameraFollowId === pipFollowAgentId) {
        officeState.cameraFollowId = null
      }
      if (pipFollowAgentId !== null) {
        setPipFollowAgentId(null)
      }
      return
    }

    const nextFollowId = pickPipAgent()
    if (nextFollowId === null) {
      return
    }

    if (officeState.cameraFollowId !== nextFollowId) {
      officeState.cameraFollowId = nextFollowId
    }
    if (officeState.selectedAgentId !== nextFollowId) {
      officeState.selectedAgentId = nextFollowId
    }
    if (pipFollowAgentId !== nextFollowId) {
      setPipFollowAgentId(nextFollowId)
    }
  }, [isPictureInPicture, officeState, pickPipAgent, pipFollowAgentId])

  useEffect(() => {
    if (!isPictureInPicture || monitorToasts.length === 0) {
      return
    }
    for (const toast of monitorToasts) {
      dismissMonitorToast(toast.id)
    }
  }, [dismissMonitorToast, isPictureInPicture, monitorToasts])

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint = editor.isEditMode && (() => {
    if (editorState.selectedFurnitureUid) {
      const item = officeState.getLayout().furniture.find((f) => f.uid === editorState.selectedFurnitureUid)
      if (item && isRotatable(item.type)) return true
    }
    if (editorState.activeTool === EditTool.FURNITURE_PLACE && isRotatable(editorState.selectedFurnitureType)) {
      return true
    }
    return false
  })()

  if (!layoutReady) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--vscode-foreground)' }}>
        Loading...
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
      `}</style>

      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
      />

      <ZoomControls
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        pipEnabled={isPictureInPicture}
        onTogglePiP={() => setIsPictureInPicture((prev) => !prev)}
      />

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--pixel-vignette)',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onOpenAgent={handleOpenAgent}
        onToggleEditMode={editor.handleToggleEditMode}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        monitorSettings={monitorSettings}
        onUpdateMonitorSettings={updateMonitorSettings}
        demoMode={demoMode}
        onUpdateDemoMode={updateDemoMode}
      />

      {!isDebugMode && !isPictureInPicture && <MonitorDashboard snapshot={monitorSnapshot} agentLabelFontPx={monitorSettings.agentLabelFontPx} />}

      {!isPictureInPicture && (
        <MonitorToasts toasts={monitorToasts} onDismiss={dismissMonitorToast} agentLabelFontPx={monitorSettings.agentLabelFontPx} />
      )}

      <CharacterInfoBoard
        officeState={officeState}
        agentTools={agentTools}
        agentStatuses={agentStatuses}
        subagentCharacters={subagentCharacters}
        monitorActivityById={monitorActivityById}
        anchor={characterBoardAnchor}
        hideMonitorAgent={isPictureInPicture}
        demoMode={demoMode}
      />

      {editor.isEditMode && editor.isDirty && (
        <EditActionBar editor={editor} editorState={editorState} />
      )}

      {showRotateHint && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: editor.isDirty ? 'translateX(calc(-50% + 100px))' : 'translateX(-50%)',
            zIndex: 49,
            background: 'var(--pixel-hint-bg)',
            color: '#fff',
            fontSize: '20px',
            padding: '3px 8px',
            borderRadius: 0,
            border: '2px solid var(--pixel-accent)',
            boxShadow: 'var(--pixel-shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Press <b>R</b> to rotate
        </div>
      )}

      {editor.isEditMode && (() => {
        // Compute selected furniture color from current layout
        const selUid = editorState.selectedFurnitureUid
        const selColor = selUid
          ? officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null
          : null
        return (
          <EditorToolbar
            activeTool={editorState.activeTool}
            selectedTileType={editorState.selectedTileType}
            selectedFurnitureType={editorState.selectedFurnitureType}
            selectedFurnitureUid={selUid}
            selectedFurnitureColor={selColor}
            floorColor={editorState.floorColor}
            wallColor={editorState.wallColor}
            onToolChange={editor.handleToolChange}
            onTileTypeChange={editor.handleTileTypeChange}
            onFloorColorChange={editor.handleFloorColorChange}
            onWallColorChange={editor.handleWallColorChange}
            onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
            onFurnitureTypeChange={editor.handleFurnitureTypeChange}
            loadedAssets={loadedAssets}
          />
        )
      })()}

      <ToolOverlay
        officeState={officeState}
        agents={agents}
        agentTools={agentTools}
        subagentCharacters={subagentCharacters}
        monitorCharacterIds={monitorCharacterIds}
        monitorActivityById={monitorActivityById}
        agentLabelFontPx={monitorSettings.agentLabelFontPx}
        containerRef={containerRef}
        zoom={editor.zoom}
        panRef={editor.panRef}
        onCloseAgent={handleCloseAgent}
        hideMonitorOverlays={isPictureInPicture}
        demoMode={demoMode}
      />

      {isDebugMode && (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          onSelectAgent={handleSelectAgent}
        />
      )}
    </div>
  )
}

export default App
