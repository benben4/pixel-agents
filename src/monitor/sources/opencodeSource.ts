import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	MONITOR_FILE_DISCOVERY_INTERVAL_MS,
	MONITOR_SEED_EVENT_LIMIT,
	MONITOR_SOURCE_FILE_LIMIT,
} from '../../constants.js';
import type { EventBus } from '../eventBus.js';
import { listFilesRecursive, safeReadJson } from '../fsUtils.js';
import type { MonitorSource } from '../normalizedEvent.js';

interface SeenState {
	size: number;
	mtimeMs: number;
}

export class OpenCodeSource {
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private readonly seenMessages = new Map<string, SeenState>();
	private readonly seenParts = new Map<string, SeenState>();
	private readonly messageToSession = new Map<string, string>();
	private readonly sessionToRepo = new Map<string, string>();
	private readonly source: MonitorSource = 'opencode';
	private intervalMs = 2000;
	private knownMessageFiles: string[] = [];
	private knownPartFiles: string[] = [];
	private knownSessionFiles: string[] = [];
	private nextDiscoveryAt = 0;
	private seededMessageEvents = 0;

	constructor(private readonly bus: EventBus) {}

	start(intervalMs?: number): void {
		if (typeof intervalMs === 'number') {
			this.intervalMs = intervalMs;
		}
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
		this.scan();
		this.pollTimer = setInterval(() => this.scan(), this.intervalMs);
	}

	dispose(): void {
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private scan(): void {
		const now = Date.now();
		const dataDir = process.env.OPENCODE_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'opencode');
		const storageDir = path.join(dataDir, 'storage');
		const messageRoot = path.join(storageDir, 'message');
		const partRoot = path.join(storageDir, 'part');
		const sessionRoot = path.join(storageDir, 'session');
		const projectRoot = path.join(storageDir, 'project');

		if (now >= this.nextDiscoveryAt || this.knownMessageFiles.length === 0) {
			this.knownSessionFiles = listFilesRecursive(sessionRoot, '.json', 3).sort((a, b) => {
				const aStat = safeStat(a);
				const bStat = safeStat(b);
				const aMs = aStat?.mtimeMs || 0;
				const bMs = bStat?.mtimeMs || 0;
				return bMs - aMs;
			}).slice(0, MONITOR_SOURCE_FILE_LIMIT);
			this.knownMessageFiles = listFilesRecursive(messageRoot, '.json', 3).sort((a, b) => {
				const aStat = safeStat(a);
				const bStat = safeStat(b);
				const aMs = aStat?.mtimeMs || 0;
				const bMs = bStat?.mtimeMs || 0;
				return bMs - aMs;
			}).slice(0, MONITOR_SOURCE_FILE_LIMIT);
			this.knownPartFiles = listFilesRecursive(partRoot, '.json', 3).sort((a, b) => {
				const aStat = safeStat(a);
				const bStat = safeStat(b);
				const aMs = aStat?.mtimeMs || 0;
				const bMs = bStat?.mtimeMs || 0;
				return bMs - aMs;
			}).slice(0, MONITOR_SOURCE_FILE_LIMIT);
			this.nextDiscoveryAt = now + MONITOR_FILE_DISCOVERY_INTERVAL_MS;
		}

		for (const filePath of this.knownSessionFiles) {
			const data = safeReadJson(filePath);
			if (!data) continue;
			const sessionId = asString(data.id) || path.basename(filePath, '.json');
			const projectId = asString(data.projectID) || asString(data.projectId);
			if (!sessionId || !projectId) continue;
			const projectFile = path.join(projectRoot, `${projectId}.json`);
			const project = safeReadJson(projectFile);
			const repoPath = asString(project?.worktree);
			if (repoPath) {
				this.sessionToRepo.set(sessionId, repoPath);
			}
		}

		for (const filePath of this.knownMessageFiles) {
			const stat = safeStat(filePath);
			if (!stat) continue;
			const prev = this.seenMessages.get(filePath);
			if (!prev) {
				this.seenMessages.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
				if (this.seededMessageEvents < MONITOR_SEED_EVENT_LIMIT) {
					const data = safeReadJson(filePath);
					if (data) {
						this.seededMessageEvents += 1;
						this.emitMessageEvent(filePath, data, stat);
					}
				}
				continue;
			}
			if (prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue;
			this.seenMessages.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });

			const data = safeReadJson(filePath);
			if (!data) continue;
			this.emitMessageEvent(filePath, data, stat);
		}

		for (const filePath of this.knownPartFiles) {
			const stat = safeStat(filePath);
			if (!stat) continue;
			const prev = this.seenParts.get(filePath);
			if (!prev) {
				this.seenParts.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });
				continue;
			}
			if (prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue;
			this.seenParts.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });

			const data = safeReadJson(filePath);
			if (!data) continue;
			const messageId = path.basename(path.dirname(filePath));
			const sessionId = this.messageToSession.get(messageId) || asString(data.sessionID) || asString(data.sessionId);
			if (!sessionId) continue;

			const partType = asString(data.type) || 'tool';
			if (partType !== 'tool') continue;
			const toolName = asString(data.tool) || 'tool';
			const state = (data.state as Record<string, unknown> | undefined) || {};
			const status = asString(state.status) || 'running';
			const startTs = asNumber((state.time as Record<string, unknown> | undefined)?.start) || stat.mtimeMs || Date.now();
			const endTs = asNumber((state.time as Record<string, unknown> | undefined)?.end);
			const stateHint = status === 'error' ? 'error' : (status === 'completed' || endTs ? 'done' : 'running');
			const filesTouched = extractFilesFromInput(state.input);

			this.bus.emit({
				source: this.source,
				session_id: sessionId,
				agent_id: sessionId,
				ts_ms: endTs || startTs,
				type: status === 'error' ? 'error' : 'tool',
				state_hint: stateHint,
				text: `${toolName}: ${status}`,
				repo_path: this.sessionToRepo.get(sessionId),
				files_touched: filesTouched,
				meta: { tool: toolName, status },
			});
		}
	}

	private emitMessageEvent(filePath: string, data: Record<string, unknown>, stat: fs.Stats): void {
		const sessionId = asString(data.sessionID) || asString(data.sessionId) || path.basename(path.dirname(filePath));
		const messageId = asString(data.id) || path.basename(filePath, '.json');
		if (!sessionId || !messageId) return;
		this.messageToSession.set(messageId, sessionId);

		const role = asString(data.role) || 'assistant';
		const text = asString(data.summary) || asString(data.finish) || `${role} message`;
		const created = asNumber((data.time as Record<string, unknown> | undefined)?.created) || stat.mtimeMs || Date.now();
		const completed = asNumber((data.time as Record<string, unknown> | undefined)?.completed);
		const repoPath = asString((data.path as Record<string, unknown> | undefined)?.root)
			|| asString((data.path as Record<string, unknown> | undefined)?.cwd)
			|| this.sessionToRepo.get(sessionId);

		this.bus.emit({
			source: this.source,
			session_id: sessionId,
			agent_id: sessionId,
			ts_ms: created,
			type: 'message',
			state_hint: completed ? 'done' : 'running',
			text,
			repo_path: repoPath,
			meta: { role, message_id: messageId },
		});
	}
}

function safeStat(filePath: string): fs.Stats | null {
	try {
		return fs.statSync(filePath);
	} catch {
		return null;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractFilesFromInput(input: unknown): string[] {
	if (!input || typeof input !== 'object') return [];
	const result: string[] = [];
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (!/(file|path)/i.test(key)) continue;
		if (typeof value === 'string' && value.length > 0) {
			result.push(value);
		}
	}
	return result;
}
