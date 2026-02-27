import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	MONITOR_CODEX_TAIL_BYTES,
	MONITOR_FILE_DISCOVERY_INTERVAL_MS,
	MONITOR_SOURCE_FILE_LIMIT,
} from '../../constants.js';
import type { EventBus } from '../eventBus.js';
import { listFilesRecursive } from '../fsUtils.js';
import type { MonitorEventType, MonitorSource, MonitorStateHint } from '../normalizedEvent.js';

interface ReaderState {
	offset: number;
	lineBuffer: string;
	lastSize: number;
}

export class CodexSource {
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private readonly readers = new Map<string, ReaderState>();
	private readonly source: MonitorSource = 'codex';
	private intervalMs = 2000;
	private knownFiles: string[] = [];
	private nextDiscoveryAt = 0;

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
		const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
		const sessionsRoot = path.join(codexHome, 'sessions');
		if (now >= this.nextDiscoveryAt || this.knownFiles.length === 0) {
			this.knownFiles = listFilesRecursive(sessionsRoot, '.jsonl', 5).sort((a, b) => {
				const aStat = safeStat(a);
				const bStat = safeStat(b);
				const aMs = aStat?.mtimeMs || 0;
				const bMs = bStat?.mtimeMs || 0;
				return bMs - aMs;
			}).slice(0, MONITOR_SOURCE_FILE_LIMIT);
			this.nextDiscoveryAt = now + MONITOR_FILE_DISCOVERY_INTERVAL_MS;
		}
		for (const filePath of this.knownFiles) {
			this.readFileIncremental(filePath);
		}
	}

	private readFileIncremental(filePath: string): void {
		const stat = safeStat(filePath);
		if (!stat) return;
		let reader = this.readers.get(filePath);
		if (!reader) {
			const seed = readSessionContext(filePath, stat.size);
			if (seed?.cwd) {
				const sessionId = seed.sessionId || parseSessionFromFile(filePath);
				this.bus.emit({
					source: this.source,
					session_id: sessionId,
					agent_id: sessionId,
					ts_ms: stat.mtimeMs || Date.now(),
					type: 'status',
					state_hint: 'idle',
					text: 'Session discovered',
					repo_path: seed.cwd,
					meta: { kind: 'seed' },
				});
			}
			const seeded = readLastRecord(filePath, stat.size);
			reader = { offset: stat.size, lineBuffer: '', lastSize: stat.size };
			this.readers.set(filePath, reader);
			if (seeded) {
				this.emitRecord(filePath, seeded, stat.mtimeMs || Date.now());
			}
			return;
		}
		if (stat.size < reader.offset) {
			reader.offset = 0;
			reader.lineBuffer = '';
		}
		if (stat.size === reader.offset) {
			reader.lastSize = stat.size;
			return;
		}

		const readLength = stat.size - reader.offset;
		const fd = fs.openSync(filePath, 'r');
		const buf = Buffer.alloc(readLength);
		fs.readSync(fd, buf, 0, readLength, reader.offset);
		fs.closeSync(fd);
		reader.offset = stat.size;
		reader.lastSize = stat.size;

		const text = reader.lineBuffer + buf.toString('utf-8');
		const lines = text.split('\n');
		reader.lineBuffer = lines.pop() || '';

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let record: Record<string, unknown> | null = null;
			try {
				record = JSON.parse(trimmed) as Record<string, unknown>;
			} catch {
				continue;
			}
			this.emitRecord(filePath, record, stat.mtimeMs || Date.now());
		}
	}

	private emitRecord(filePath: string, record: Record<string, unknown>, fallbackTs: number): void {
		const payload = (record.payload as Record<string, unknown> | undefined) || {};
		const kind = asString(record.type) || asString(payload.type) || 'event';
		const sessionId = asString(payload.id)
			|| asString(record.session_id)
			|| asString(record.sessionId)
			|| parseSessionFromFile(filePath);
		if (!sessionId) return;

		const timestamp = toTimestamp(record, payload, fallbackTs);
		const repoPath = asString(payload.cwd)
			|| asString(record.cwd)
			|| extractTaggedPath(asString(record.message) || asString(payload.message));

		const mapping = classifyCodexRecord(kind, payload, record);
		const filesTouched = extractFiles(payload.input || record.input);

		this.bus.emit({
			source: this.source,
			session_id: sessionId,
			agent_id: sessionId,
			ts_ms: timestamp,
			type: mapping.type,
			state_hint: mapping.state,
			text: mapping.text,
			repo_path: repoPath,
			files_touched: filesTouched,
			meta: { kind },
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

function toTimestamp(record: Record<string, unknown>, payload: Record<string, unknown>, fallbackTs: number): number {
	const numeric = [record.ts, record.timestamp, payload.ts, payload.timestamp].find((v) => typeof v === 'number');
	if (typeof numeric === 'number' && Number.isFinite(numeric)) {
		return numeric;
	}
	const iso = [record.timestamp, payload.timestamp].find((v) => typeof v === 'string');
	if (typeof iso === 'string') {
		const parsed = Date.parse(iso);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	return fallbackTs;
}

function parseSessionFromFile(filePath: string): string {
	const base = path.basename(filePath, '.jsonl');
	const uuidMatch = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
	if (uuidMatch) {
		return uuidMatch[1];
	}
	const parts = base.split('-');
	if (parts.length >= 2) {
		return parts[parts.length - 1];
	}
	return base;
}

function classifyCodexRecord(
	kind: string,
	payload: Record<string, unknown>,
	record: Record<string, unknown>,
): { state: MonitorStateHint; type: MonitorEventType; text: string } {
	const payloadType = asString(payload.type) || '';
	const lower = `${kind} ${payloadType}`.toLowerCase();
	if (lower.includes('task_complete') || lower.includes('turn_completed') || lower.includes('turn.complete') || lower.includes('task.complete') || lower.includes('item.completed') || lower.includes('completed')) {
		return { state: 'done', type: 'status', text: 'Turn completed' };
	}
	if (lower.includes('turn_aborted') || lower.includes('task_aborted') || lower.includes('aborted')) {
		return { state: 'waiting', type: 'status', text: 'Turn aborted' };
	}
	if (lower.includes('error') || lower.includes('failed') || lower.includes('exception') || lower.includes('fatal')) {
		return { state: 'error', type: 'error', text: 'Codex error' };
	}
	if (payloadType === 'agent_message' || payloadType === 'message') {
		const message = asString(record.message) || asString(payload.message) || 'Assistant message';
		return { state: 'running', type: 'message', text: message };
	}
	if (payloadType === 'agent_reasoning' || payloadType === 'reasoning') {
		return { state: 'thinking', type: 'status', text: 'Thinking' };
	}
	if (payloadType === 'task_started') {
		return { state: 'running', type: 'status', text: 'Task started' };
	}
	if (payloadType === 'user_message') {
		return { state: 'waiting', type: 'message', text: 'Waiting for input' };
	}
	if (payloadType === 'function_call') {
		const toolName = asString(payload.name) || asString((payload.function as Record<string, unknown> | undefined)?.name) || 'tool';
		return { state: 'running', type: 'tool', text: `${toolName}: running` };
	}
	if (payloadType === 'function_call_output') {
		return { state: 'running', type: 'tool', text: 'Tool output' };
	}
	if (payloadType === 'custom_tool_call') {
		const toolName = asString(payload.name) || 'custom tool';
		return { state: 'running', type: 'tool', text: `${toolName}: running` };
	}
	if (payloadType === 'custom_tool_call_output') {
		return { state: 'running', type: 'tool', text: 'Tool output' };
	}
	if (payloadType === 'message' && asString(payload.role) === 'user') {
		return { state: 'waiting', type: 'message', text: 'Waiting for input' };
	}
	if (payloadType === 'token_count' || lower.includes('token_count')) {
		return { state: 'thinking', type: 'status', text: 'Thinking' };
	}
	return {
		state: 'running',
		type: 'message',
		text: asString(record.message) || asString(payload.message) || kind,
	};
}

function extractTaggedPath(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const match = text.match(/<cwd>(.*?)<\/cwd>/);
	return match ? match[1] : undefined;
}

function extractFiles(input: unknown): string[] {
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

function readLastRecord(filePath: string, size: number): Record<string, unknown> | null {
	if (size <= 0) return null;
	const bytes = Math.min(size, MONITOR_CODEX_TAIL_BYTES);
	const offset = size - bytes;
	const fd = fs.openSync(filePath, 'r');
	try {
		const buf = Buffer.alloc(bytes);
		fs.readSync(fd, buf, 0, bytes, offset);
		const text = buf.toString('utf-8');
		const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				return JSON.parse(lines[i]) as Record<string, unknown>;
			} catch {
				continue;
			}
		}
		return null;
	} finally {
		fs.closeSync(fd);
	}
}

function readSessionContext(filePath: string, size: number): { sessionId?: string; cwd?: string } | null {
	if (size <= 0) return null;
	const bytes = Math.min(size, MONITOR_CODEX_TAIL_BYTES);
	const fd = fs.openSync(filePath, 'r');
	try {
		const buf = Buffer.alloc(bytes);
		fs.readSync(fd, buf, 0, bytes, 0);
		const text = buf.toString('utf-8');
		const lines = text.split('\n');
		let sessionId: string | undefined;
		let cwd: string | undefined;
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let record: Record<string, unknown>;
			try {
				record = JSON.parse(trimmed) as Record<string, unknown>;
			} catch {
				continue;
			}
			const payload = (record.payload as Record<string, unknown> | undefined) || {};
			sessionId = sessionId || asString(payload.id) || asString(record.session_id) || asString(record.sessionId);
			cwd = cwd || asString(payload.cwd) || asString(record.cwd);
			if (sessionId && cwd) {
				break;
			}
		}
		if (!sessionId && !cwd) {
			return null;
		}
		return { sessionId, cwd };
	} finally {
		fs.closeSync(fd);
	}
}
