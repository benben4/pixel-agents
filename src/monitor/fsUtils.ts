import * as fs from 'fs';
import * as path from 'path';

export function safeReadJson(filePath: string): Record<string, unknown> | null {
	try {
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function listFilesRecursive(root: string, suffix: string, maxDepth: number): string[] {
	const out: string[] = [];
	walk(root, suffix, maxDepth, out);
	return out;
}

function walk(root: string, suffix: string, depth: number, out: string[]): void {
	if (depth < 0) return;
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			walk(fullPath, suffix, depth - 1, out);
			continue;
		}
		if (entry.isFile() && fullPath.endsWith(suffix)) {
			out.push(fullPath);
		}
	}
}
