import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentStore } from '../agentStore.js';

const execFileAsync = promisify(execFile);

interface RepoTarget {
	source: string;
	session_id: string;
	repo_path: string;
}

interface GhPrStatus {
	currentBranch?: {
		number?: number;
		title?: string;
		url?: string;
		state?: string;
		reviewDecision?: string;
		mergeStateStatus?: string;
	};
}

export class PrStatusPoller {
	private timer: ReturnType<typeof setInterval> | null = null;
	private isRunning = false;
	private intervalMs = 90000;

	constructor(private readonly store: AgentStore) {}

	start(intervalMs?: number): void {
		if (typeof intervalMs === 'number') {
			this.intervalMs = intervalMs;
		}
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		void this.poll();
		this.timer = setInterval(() => {
			void this.poll();
		}, this.intervalMs);
	}

	dispose(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private async poll(): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;
		try {
			const repos = this.store.getTrackedRepos();
			for (const target of repos) {
				await this.pollRepo(target);
			}
		} finally {
			this.isRunning = false;
		}
	}

	private async pollRepo(target: RepoTarget): Promise<void> {
		const now = Date.now();
		try {
			const result = await execFileAsync(
				'gh',
				[
					'pr',
					'status',
					'--json',
					'currentBranch',
				],
				{ cwd: target.repo_path, timeout: 12000 },
			);
			const parsed = JSON.parse(result.stdout) as GhPrStatus;
			const pr = parsed.currentBranch;
			this.store.applyPrState(target.source, target.session_id, {
				available: true,
				has_open_pr: Boolean(pr?.number),
				title: pr?.title,
				url: pr?.url,
				state: pr?.state,
				merge_state_status: pr?.mergeStateStatus,
				review_decision: pr?.reviewDecision,
				last_checked_ms: now,
			});
		} catch (error) {
			this.store.applyPrState(target.source, target.session_id, {
				available: false,
				has_open_pr: false,
				last_checked_ms: now,
				error: error instanceof Error ? error.message : 'gh unavailable',
			});
		}
	}
}
