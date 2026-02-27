import type { NormalizedEvent } from './normalizedEvent.js';

type Listener = (event: NormalizedEvent) => void;

export class EventBus {
	private readonly listeners = new Set<Listener>();

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: NormalizedEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
