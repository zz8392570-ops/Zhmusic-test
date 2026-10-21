import { resolveLocalFile } from './localFile'
import { isLocalSongUrl } from './songSharing'
export type OfflineAvailability = 'available' | 'missing' | 'unknown'

/** Share in-flight work only; re-entering a screen must recheck the actual file. */
export function createOfflineAvailabilityLookup(probe = resolveLocalFile, concurrency = 4) {
	let active = 0
	const waiting: (() => void)[] = []
	const pending = new Map<string, Promise<OfflineAvailability>>()
	const drain = () => {
		while (active < concurrency && waiting.length) waiting.shift()!()
	}
	return (url: unknown, revision = 0): Promise<OfflineAvailability> => {
		if (!isLocalSongUrl(url)) return Promise.resolve('unknown')
		const key = JSON.stringify([revision, url])
		if (pending.has(key)) return pending.get(key)!
		let complete!: (state: OfflineAvailability) => void
		const promise = new Promise<OfflineAvailability>((resolve) => {
			complete = resolve
		})
		pending.set(key, promise)
		waiting.push(() => {
			active++
			void Promise.resolve()
				.then(() => probe(String(url), { requireOwnedMedia: true }))
				.then(
					(result): OfflineAvailability =>
						result.status === 'resolved'
							? 'available'
							: result.status === 'unresolved' && result.reason === 'missing'
								? 'missing'
								: 'unknown',
					(): OfflineAvailability => 'unknown',
				)
				.then(complete)
				.finally(() => {
					pending.delete(key)
					active--
					drain()
				})
		})
		drain()
		return promise
	}
}
export const getOfflineAvailability = createOfflineAvailabilityLookup()
