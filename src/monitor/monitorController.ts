import * as vscode from 'vscode';
import {
	GLOBAL_KEY_MONITOR_SETTINGS,
	GLOBAL_KEY_MONITOR_REPO_BINDINGS,
} from '../constants.js';
import { AgentStore } from './agentStore.js';
import { EventBus } from './eventBus.js';
import { GitStatusPoller } from './git/gitStatusPoller.js';
import { PrStatusPoller } from './git/prStatusPoller.js';
import type { MonitorSnapshot } from './normalizedEvent.js';
import { CodexSource } from './sources/codexSource.js';
import { OpenCodeSource } from './sources/opencodeSource.js';
import { DEFAULT_MONITOR_SETTINGS, sanitizeMonitorSettings } from './settings.js';
import type { MonitorSettings } from './settings.js';

export class MonitorController {
	private readonly bus = new EventBus();
	private readonly store = new AgentStore();
	private readonly opencode = new OpenCodeSource(this.bus);
	private readonly codex = new CodexSource(this.bus);
	private readonly gitPoller = new GitStatusPoller(this.store);
	private readonly prPoller = new PrStatusPoller(this.store);
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private unsubscribe: (() => void) | null = null;
	private webview: vscode.Webview | undefined;
	private settings: MonitorSettings = DEFAULT_MONITOR_SETTINGS;
	private started = false;

	constructor(private readonly context: vscode.ExtensionContext) {}

	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;
		const bindings = this.context.globalState.get<Record<string, string>>(GLOBAL_KEY_MONITOR_REPO_BINDINGS, {});
		this.settings = sanitizeMonitorSettings(this.context.globalState.get<MonitorSettings>(GLOBAL_KEY_MONITOR_SETTINGS, DEFAULT_MONITOR_SETTINGS));
		this.store.loadBindings(bindings);
		this.unsubscribe = this.bus.subscribe((event) => {
			this.store.applyEvent(event);
		});
		this.applyRuntime();
	}

	setWebview(webview: vscode.Webview | undefined): void {
		this.webview = webview;
	}

	getSettings(): MonitorSettings {
		return this.settings;
	}

	updateSettings(raw: unknown): void {
		this.settings = sanitizeMonitorSettings(raw);
		void this.context.globalState.update(GLOBAL_KEY_MONITOR_SETTINGS, this.settings);
		this.applyRuntime();
		this.sendSnapshot();
	}

	sendSnapshot(): void {
		if (!this.webview) return;
		const snapshot = this.store.snapshot(Date.now());
		this.webview.postMessage({ type: 'monitorStateUpdate', snapshot });
	}

	bindRepoPath(source: string, sessionId: string, repoPath: string): void {
		this.store.setRepoBinding(source, sessionId, repoPath);
		void this.context.globalState.update(GLOBAL_KEY_MONITOR_REPO_BINDINGS, this.store.getBindingsObject());
		this.sendSnapshot();
	}

	getSnapshot(): MonitorSnapshot {
		return this.store.snapshot(Date.now());
	}

	dispose(): void {
		this.started = false;
		this.clearFlushTimer();
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.opencode.dispose();
		this.codex.dispose();
		this.gitPoller.dispose();
		this.prPoller.dispose();
	}

	private flush(): void {
		if (!this.webview) return;
		this.sendSnapshot();
		const notifications = this.store.drainNotifications();
		for (const note of notifications) {
			this.webview.postMessage({
				type: 'monitorNotification',
				notification: note,
			});
		}
	}

	private applyRuntime(): void {
		if (this.settings.enabled && this.settings.enableOpencode) {
			this.opencode.start(this.settings.sourcePollIntervalMs);
		} else {
			this.opencode.dispose();
		}
		if (this.settings.enabled && this.settings.enableCodex) {
			this.codex.start(this.settings.sourcePollIntervalMs);
		} else {
			this.codex.dispose();
		}
		if (this.settings.enabled && this.settings.enableGit) {
			this.gitPoller.start(this.settings.gitPollIntervalMs);
		} else {
			this.gitPoller.dispose();
		}
		if (this.settings.enabled && this.settings.enablePr) {
			this.prPoller.start(this.settings.prPollIntervalMs);
		} else {
			this.prPoller.dispose();
		}
		this.clearFlushTimer();
		if (this.settings.enabled) {
			this.flushTimer = setInterval(() => this.flush(), this.settings.flushIntervalMs);
		}
	}

	private clearFlushTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
	}
}
