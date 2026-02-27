import {
	MONITOR_DONE_AFTER_MS,
	MONITOR_IDLE_AFTER_MS,
	MONITOR_SOURCE_FILE_LIMIT,
} from '../constants.js';
import type {
	MonitorAgentView,
	MonitorAlert,
	MonitorEventView,
	MonitorGitState,
	MonitorPrState,
	MonitorSnapshot,
	MonitorStateHint,
	MonitorSummary,
	NormalizedEvent,
} from './normalizedEvent.js';

const MAX_EVENTS = 20;
const MAX_FILES = 20;
const MAX_ALERTS = 10;
const TRANSIENT_TEXTS = new Set(['Thinking', 'Tool output', 'Task started', 'Session discovered']);

interface MonitorAgentInternal extends MonitorAgentView {
	last_notified_state?: MonitorStateHint;
}

interface MonitorNotification {
	title: string;
	message: string;
	kind: 'done' | 'error';
	key: string;
}

function agentKey(source: string, sessionId: string): string {
	return `${source}:${sessionId}`;
}

export class AgentStore {
	private readonly agents = new Map<string, MonitorAgentInternal>();
	private readonly pendingNotifications: MonitorNotification[] = [];
	private readonly repoBindings = new Map<string, string>();

	loadBindings(bindings: Record<string, string>): void {
		for (const [key, value] of Object.entries(bindings)) {
			if (value) {
				this.repoBindings.set(key, value);
			}
		}
	}

	getBindingsObject(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [key, value] of this.repoBindings) {
			out[key] = value;
		}
		return out;
	}

	setRepoBinding(source: string, sessionId: string, repoPath: string): void {
		const key = agentKey(source, sessionId);
		this.repoBindings.set(key, repoPath);
		const existing = this.agents.get(key);
		if (existing) {
			existing.repo_path = repoPath;
		}
	}

	applyEvent(event: NormalizedEvent): void {
		const key = agentKey(event.source, event.session_id);
		let entry = this.agents.get(key);
		if (!entry) {
			entry = {
				key,
				source: event.source,
				session_id: event.session_id,
				agent_id: event.agent_id,
				display_name: `${event.source}: ${event.session_id.slice(0, 8)}`,
				state: event.state_hint,
				last_ts_ms: event.ts_ms,
				last_text: event.text,
				repo_path: event.repo_path ?? this.repoBindings.get(key),
				files_touched: [],
				alerts: [],
				recent_events: [],
			};
			this.agents.set(key, entry);
		}

		entry.agent_id = event.agent_id;
		entry.last_ts_ms = Math.max(entry.last_ts_ms, event.ts_ms);
		entry.state = event.state_hint;
		if (event.text) {
			entry.last_text = event.text;
		}
		if (event.repo_path) {
			entry.repo_path = event.repo_path;
		}
		if (!entry.repo_path) {
			entry.repo_path = this.repoBindings.get(key);
		}

		if (event.files_touched && event.files_touched.length > 0) {
			const merged = [...event.files_touched, ...entry.files_touched];
			const deduped: string[] = [];
			for (const file of merged) {
				if (!file) continue;
				if (!deduped.includes(file)) {
					deduped.push(file);
				}
				if (deduped.length >= MAX_FILES) {
					break;
				}
			}
			entry.files_touched = deduped;
		}

		const eventView: MonitorEventView = {
			ts_ms: event.ts_ms,
			type: event.type,
			state_hint: event.state_hint,
			text: event.text,
			files_touched: event.files_touched,
		};
		entry.recent_events = [eventView, ...entry.recent_events].slice(0, MAX_EVENTS);

		if (event.type === 'error' || event.state_hint === 'error') {
			this.pushAlert(entry, {
				kind: 'error',
				message: event.text || 'Error detected',
				ts_ms: event.ts_ms,
			});
		} else {
			entry.alerts = entry.alerts.filter((a) => a.kind !== 'error');
		}

		if ((event.state_hint === 'done' || event.state_hint === 'error') && entry.last_notified_state !== event.state_hint) {
			this.pendingNotifications.push({
				title: event.state_hint === 'error' ? 'Agent error' : 'Agent done',
				message: `${entry.display_name}${entry.last_text ? ` - ${entry.last_text}` : ''}`,
				kind: event.state_hint === 'error' ? 'error' : 'done',
				key,
			});
			entry.last_notified_state = event.state_hint;
		}
	}

	applyGitState(source: string, sessionId: string, git: MonitorGitState): void {
		const key = agentKey(source, sessionId);
		const entry = this.agents.get(key);
		if (!entry) return;
		entry.git = git;
		this.recomputeRepoAlerts(entry);
	}

	applyPrState(source: string, sessionId: string, pr: MonitorPrState): void {
		const key = agentKey(source, sessionId);
		const entry = this.agents.get(key);
		if (!entry) return;
		entry.pr = pr;
		this.recomputeRepoAlerts(entry);
	}

	drainNotifications(): MonitorNotification[] {
		const copy = [...this.pendingNotifications];
		this.pendingNotifications.length = 0;
		return copy;
	}

	getTrackedRepos(): Array<{ source: string; session_id: string; repo_path: string }> {
		const repos: Array<{ source: string; session_id: string; repo_path: string }> = [];
		for (const entry of this.agents.values()) {
			if (!entry.repo_path) continue;
			repos.push({
				source: entry.source,
				session_id: entry.session_id,
				repo_path: entry.repo_path,
			});
		}
		return repos;
	}

		snapshot(nowMs: number): MonitorSnapshot {
		for (const entry of this.agents.values()) {
			const silence = nowMs - entry.last_ts_ms;
			if ((entry.state === 'running' || entry.state === 'thinking' || entry.state === 'waiting') && silence > MONITOR_IDLE_AFTER_MS) {
				entry.state = 'idle';
				if (!entry.last_text || TRANSIENT_TEXTS.has(entry.last_text)) {
					entry.last_text = 'Idle';
				}
			}
			if (entry.state === 'idle' && silence > MONITOR_DONE_AFTER_MS) {
				entry.state = 'done';
				if (!entry.last_text || TRANSIENT_TEXTS.has(entry.last_text) || entry.last_text === 'Idle') {
					entry.last_text = 'No recent activity';
				}
			}
			this.recomputeRepoAlerts(entry);
		}

		const sortedAgents = [...this.agents.values()].sort((a, b) => b.last_ts_ms - a.last_ts_ms);
		const agents = sortedAgents.slice(0, MONITOR_SOURCE_FILE_LIMIT);
		if (sortedAgents.length > MONITOR_SOURCE_FILE_LIMIT) {
			const keep = new Set(agents.map((agent) => agent.key));
			for (const key of this.agents.keys()) {
				if (!keep.has(key)) {
					this.agents.delete(key);
				}
			}
		}
		const summary: MonitorSummary = {
			total: agents.length,
			active: agents.filter((a) => a.state === 'running' || a.state === 'thinking').length,
			waiting: agents.filter((a) => a.state === 'waiting').length,
			done: agents.filter((a) => a.state === 'done').length,
			error: agents.filter((a) => a.state === 'error').length,
			pr_pending: agents.filter((a) => a.pr?.has_open_pr && a.pr.state !== 'MERGED').length,
			alerts: agents.reduce((total, a) => total + a.alerts.length, 0),
		};

		return {
			summary,
			agents,
			now_ms: nowMs,
		};
	}

	private recomputeRepoAlerts(entry: MonitorAgentInternal): void {
		entry.alerts = entry.alerts.filter((a) => a.kind === 'error').slice(0, MAX_ALERTS);
		if (entry.git?.dirty) {
			this.pushAlert(entry, {
				kind: 'dirty',
				message: 'Repository has uncommitted changes',
				ts_ms: Date.now(),
			});
		}
		if (entry.pr?.has_open_pr && entry.pr.state !== 'MERGED') {
			this.pushAlert(entry, {
				kind: 'pr-pending',
				message: 'PR is still open',
				ts_ms: Date.now(),
			});
		}
	}

	private pushAlert(entry: MonitorAgentInternal, alert: MonitorAlert): void {
		const existing = entry.alerts.find((a) => a.kind === alert.kind && a.message === alert.message);
		if (existing) return;
		entry.alerts = [alert, ...entry.alerts].slice(0, MAX_ALERTS);
	}
}
