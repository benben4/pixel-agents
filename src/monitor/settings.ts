import {
	MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
	MONITOR_AGENT_LABEL_FONT_MAX_PX,
	MONITOR_AGENT_LABEL_FONT_MIN_PX,
	MONITOR_FLUSH_INTERVAL_MS,
	MONITOR_GIT_POLL_INTERVAL_MS,
	MONITOR_POLL_INTERVAL_MS,
	MONITOR_PR_POLL_INTERVAL_MS,
} from '../constants.js';

export interface MonitorSettings {
	enabled: boolean;
	enableClaude: boolean;
	enableOpencode: boolean;
	enableCodex: boolean;
	enableGit: boolean;
	enablePr: boolean;
	flushIntervalMs: number;
	sourcePollIntervalMs: number;
	gitPollIntervalMs: number;
	prPollIntervalMs: number;
	agentLabelFontPx: number;
	maxIdleAgents: number;
}

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
	enabled: true,
	enableClaude: true,
	enableOpencode: true,
	enableCodex: true,
	enableGit: true,
	enablePr: true,
	flushIntervalMs: MONITOR_FLUSH_INTERVAL_MS,
	sourcePollIntervalMs: MONITOR_POLL_INTERVAL_MS,
	gitPollIntervalMs: MONITOR_GIT_POLL_INTERVAL_MS,
	prPollIntervalMs: MONITOR_PR_POLL_INTERVAL_MS,
	agentLabelFontPx: MONITOR_AGENT_LABEL_FONT_DEFAULT_PX,
	maxIdleAgents: 3,
};

export function sanitizeMonitorSettings(raw: unknown): MonitorSettings {
	const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		enabled: asBool(value.enabled, DEFAULT_MONITOR_SETTINGS.enabled),
		enableClaude: asBool(value.enableClaude, DEFAULT_MONITOR_SETTINGS.enableClaude),
		enableOpencode: asBool(value.enableOpencode, DEFAULT_MONITOR_SETTINGS.enableOpencode),
		enableCodex: asBool(value.enableCodex, DEFAULT_MONITOR_SETTINGS.enableCodex),
		enableGit: asBool(value.enableGit, DEFAULT_MONITOR_SETTINGS.enableGit),
		enablePr: asBool(value.enablePr, DEFAULT_MONITOR_SETTINGS.enablePr),
		flushIntervalMs: asNumber(value.flushIntervalMs, DEFAULT_MONITOR_SETTINGS.flushIntervalMs),
		sourcePollIntervalMs: asNumber(value.sourcePollIntervalMs, DEFAULT_MONITOR_SETTINGS.sourcePollIntervalMs),
		gitPollIntervalMs: asNumber(value.gitPollIntervalMs, DEFAULT_MONITOR_SETTINGS.gitPollIntervalMs),
		prPollIntervalMs: asNumber(value.prPollIntervalMs, DEFAULT_MONITOR_SETTINGS.prPollIntervalMs),
		agentLabelFontPx: asFontPx(value.agentLabelFontPx, DEFAULT_MONITOR_SETTINGS.agentLabelFontPx),
		maxIdleAgents: asIdleCount(value.maxIdleAgents, DEFAULT_MONITOR_SETTINGS.maxIdleAgents),
	};
}

function asBool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 500) {
		return fallback;
	}
	return Math.round(value);
}

function asFontPx(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	const rounded = Math.round(value);
	if (rounded < MONITOR_AGENT_LABEL_FONT_MIN_PX || rounded > MONITOR_AGENT_LABEL_FONT_MAX_PX) {
		return fallback;
	}
	return rounded;
}

function asIdleCount(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	const rounded = Math.round(value);
	if (rounded < 0) {
		return fallback;
	}
	return rounded;
}
