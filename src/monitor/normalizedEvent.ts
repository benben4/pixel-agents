export const MONITOR_SOURCES = ['opencode', 'codex'] as const;
export type MonitorSource = (typeof MONITOR_SOURCES)[number];

export const MONITOR_EVENT_TYPES = ['message', 'tool', 'cmd', 'error', 'status'] as const;
export type MonitorEventType = (typeof MONITOR_EVENT_TYPES)[number];

export const MONITOR_STATE_HINTS = ['idle', 'thinking', 'running', 'waiting', 'done', 'error'] as const;
export type MonitorStateHint = (typeof MONITOR_STATE_HINTS)[number];

export interface NormalizedEvent {
	source: MonitorSource;
	session_id: string;
	agent_id: string;
	ts_ms: number;
	type: MonitorEventType;
	state_hint: MonitorStateHint;
	text?: string;
	repo_path?: string;
	files_touched?: string[];
	meta?: Record<string, unknown>;
}

export interface MonitorEventView {
	ts_ms: number;
	type: MonitorEventType;
	state_hint: MonitorStateHint;
	text?: string;
	files_touched?: string[];
}

export interface MonitorGitState {
	branch?: string;
	dirty: boolean;
	ahead?: number;
	behind?: number;
	last_checked_ms: number;
	error?: string;
}

export interface MonitorPrState {
	available: boolean;
	has_open_pr: boolean;
	title?: string;
	url?: string;
	state?: string;
	merge_state_status?: string;
	review_decision?: string;
	last_checked_ms: number;
	error?: string;
}

export interface MonitorAlert {
	kind: 'error' | 'pr-pending' | 'dirty';
	message: string;
	ts_ms: number;
}

export interface MonitorAgentView {
	key: string;
	source: MonitorSource;
	session_id: string;
	agent_id: string;
	display_name: string;
	state: MonitorStateHint;
	last_ts_ms: number;
	last_text?: string;
	repo_path?: string;
	files_touched: string[];
	alerts: MonitorAlert[];
	recent_events: MonitorEventView[];
	git?: MonitorGitState;
	pr?: MonitorPrState;
}

export interface MonitorSummary {
	total: number;
	active: number;
	waiting: number;
	done: number;
	error: number;
	pr_pending: number;
	alerts: number;
}

export interface MonitorSnapshot {
	summary: MonitorSummary;
	agents: MonitorAgentView[];
	now_ms: number;
}
