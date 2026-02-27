// ── Timing (ms) ──────────────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 2000;
export const PROJECT_SCAN_INTERVAL_MS = 1000;
export const TOOL_DONE_DELAY_MS = 300;
export const PERMISSION_TIMER_DELAY_MS = 7000;
export const TEXT_IDLE_DELAY_MS = 5000;
export const MONITOR_FLUSH_INTERVAL_MS = 1000;
export const MONITOR_POLL_INTERVAL_MS = 2000;
export const MONITOR_FILE_DISCOVERY_INTERVAL_MS = 30000;
export const MONITOR_GIT_POLL_INTERVAL_MS = 20000;
export const MONITOR_PR_POLL_INTERVAL_MS = 90000;
export const MONITOR_IDLE_AFTER_MS = 20000;
export const MONITOR_DONE_AFTER_MS = 90000;
export const MONITOR_SEED_EVENT_LIMIT = 40;
export const MONITOR_CODEX_TAIL_BYTES = 65536;
export const MONITOR_SOURCE_FILE_LIMIT = 20;
export const MONITOR_AGENT_LABEL_FONT_DEFAULT_PX = 24;
export const MONITOR_AGENT_LABEL_FONT_MIN_PX = 14;
export const MONITOR_AGENT_LABEL_FONT_MAX_PX = 40;

// ── Display Truncation ──────────────────────────────────────
export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ── PNG / Asset Parsing ─────────────────────────────────────
export const PNG_ALPHA_THRESHOLD = 128;
export const WALL_PIECE_WIDTH = 16;
export const WALL_PIECE_HEIGHT = 32;
export const WALL_GRID_COLS = 4;
export const WALL_BITMASK_COUNT = 16;
export const FLOOR_PATTERN_COUNT = 7;
export const FLOOR_TILE_SIZE = 16;
export const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
export const CHAR_FRAMES_PER_ROW = 7;
export const CHAR_COUNT = 6;

// ── User-Level Layout Persistence ─────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
export const GLOBAL_KEY_DEMO_MODE = 'pixel-agents.demoMode';
export const GLOBAL_KEY_MONITOR_REPO_BINDINGS = 'pixel-agents.monitorRepoBindings';
export const GLOBAL_KEY_MONITOR_SETTINGS = 'pixel-agents.monitorSettings';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX = 'Claude Code';
export const TERMINAL_NAME_PREFIX_OPENCODE = 'OpenCode';
export const TERMINAL_NAME_PREFIX_CODEX = 'Codex';
