import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AgentStore } from '../agentStore.js';

const execFileAsync = promisify(execFile);

interface RepoTarget {
	source: string;
	session_id: string;
	repo_path: string;
}

export class GitStatusPoller {
	private timer: ReturnType<typeof setInterval> | null = null;
	private isRunning = false;
	private intervalMs = 20000;

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
			const [statusResult, branchResult] = await Promise.all([
				execFileAsync('git', ['status', '--porcelain'], { cwd: target.repo_path, timeout: 7000 }),
				execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: target.repo_path, timeout: 7000 }),
			]);
			let ahead: number | undefined;
			let behind: number | undefined;
			try {
				const tracking = await execFileAsync('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], {
					cwd: target.repo_path,
					timeout: 7000,
				});
				const parts = tracking.stdout.trim().split(/\s+/);
				if (parts.length === 2) {
					behind = Number.parseInt(parts[0], 10);
					ahead = Number.parseInt(parts[1], 10);
				}
			} catch {
			}

			this.store.applyGitState(target.source, target.session_id, {
				branch: branchResult.stdout.trim(),
				dirty: statusResult.stdout.trim().length > 0,
				ahead,
				behind,
				last_checked_ms: now,
			});
		} catch (error) {
			this.store.applyGitState(target.source, target.session_id, {
				dirty: false,
				last_checked_ms: now,
				error: error instanceof Error ? error.message : 'git check failed',
			});
		}
	}
}
