import type { AudioQuality } from '@/helpers/audioQuality'
import { getCachedQuality, getCacheDisplayProbeKey } from '@/player/CacheManager'
import { cacheRevisionStore, qualityStore } from '@/player/PlayerStore'
import type { Track } from '@/player/types'

export type CacheDisplayResult = {
	quality: AudioQuality | null
	status: 'ready' | 'failed' | 'stale'
}
type CacheScanResult = { keys: Set<string>; hasErrors: boolean }
type LookupOptions = {
	query: (track: IMusic.IMusicItem) => Promise<AudioQuality | null>
	probeKey: (track: IMusic.IMusicItem) => string
	contextKey: () => string
	concurrency?: number
	maxEntries?: number
	ttlMs?: number
	now?: () => number
}

/** Short-lived memoization belongs to UI only, never to the playback/file resolver. */
export const createCacheDisplayLookup = ({
	query,
	probeKey,
	contextKey,
	concurrency = 4,
	maxEntries = 512,
	ttlMs = 30_000,
	now = Date.now,
}: LookupOptions) => {
	const limit = Math.max(1, concurrency)
	const memo = new Map<string, { result: CacheDisplayResult; expiresAt: number }>()
	const pending = new Map<string, Promise<CacheDisplayResult>>()
	const queue: Array<() => void> = []
	let active = 0
	let memoContext = contextKey()
	const stale = (): CacheDisplayResult => ({ quality: null, status: 'stale' })
	const key = (track: IMusic.IMusicItem) => JSON.stringify([contextKey(), probeKey(track)])
	const refreshContext = () => {
		const current = contextKey()
		if (memoContext !== current) {
			memo.clear()
			memoContext = current
		}
	}
	const drain = () => {
		while (active < limit && queue.length) queue.shift()!()
	}
	const peek = (track: IMusic.IMusicItem): CacheDisplayResult | undefined => {
		refreshContext()
		const lookupKey = key(track)
		const cached = memo.get(lookupKey)
		if (cached && cached.expiresAt > now()) return cached.result
		memo.delete(lookupKey)
		return undefined
	}
	const get = (input: IMusic.IMusicItem): Promise<CacheDisplayResult> => {
		const track = { ...input, title: String(input.title ?? ''), artist: String(input.artist ?? '') }
		const cached = peek(track)
		if (cached) return Promise.resolve(cached)
		const lookupKey = key(track)
		const shared = pending.get(lookupKey)
		if (shared) return shared
		let resolve!: (result: CacheDisplayResult) => void
		const promise = new Promise<CacheDisplayResult>((complete) => {
			resolve = complete
		})
		pending.set(lookupKey, promise)
		queue.push(() => {
			if (key(track) !== lookupKey) {
				if (pending.get(lookupKey) === promise) pending.delete(lookupKey)
				resolve(stale())
				return
			}
			active++
			void Promise.resolve()
				.then(() => query(track))
				.then(
					(quality): CacheDisplayResult => ({ quality, status: 'ready' }),
					(): CacheDisplayResult => ({ quality: null, status: 'failed' }),
				)
				.then((result) => {
					if (key(track) !== lookupKey) result = stale()
					if (result.status === 'ready') {
						while (memo.size >= Math.max(1, maxEntries)) memo.delete(memo.keys().next().value!)
						memo.set(lookupKey, { result, expiresAt: now() + ttlMs })
					}
					if (pending.get(lookupKey) === promise) pending.delete(lookupKey)
					resolve(result)
				})
				.finally(() => {
					active--
					drain()
				})
		})
		drain()
		return promise
	}
	const trackKey = (track: Track) =>
		JSON.stringify(
			[track, ...(track.sourceAlternatives ?? [])].map((item) => key(item as IMusic.IMusicItem)),
		)
	const scan = async (
		tracks: Track[],
		{
			isCancelled = () => false,
			onProgress,
		}: {
			isCancelled?: () => boolean
			onProgress?: (result: CacheScanResult) => void
		} = {},
	): Promise<CacheScanResult> => {
		const context = contextKey()
		const keys = new Set<string>()
		let hasErrors = false
		let next = 0
		const cancelled = () => isCancelled() || contextKey() !== context
		const worker = async () => {
			while (!cancelled() && next < tracks.length) {
				const track = tracks[next++]
				const lookupKey = trackKey(track)
				for (const candidate of [track, ...(track.sourceAlternatives ?? [])]) {
					if (cancelled()) return
					const result = await get(candidate as IMusic.IMusicItem)
					if (cancelled()) return
					hasErrors ||= result.status === 'failed'
					if (result.status === 'ready' && result.quality && trackKey(track) === lookupKey) {
						keys.add(lookupKey)
						break
					}
				}
				if (!cancelled()) onProgress?.({ keys: new Set(keys), hasErrors })
			}
		}
		await Promise.all(Array.from({ length: Math.min(limit, tracks.length) }, worker))
		return { keys, hasErrors }
	}
	return { get, peek, key, trackKey, scan, contextKey }
}

export const cacheDisplayLookup = createCacheDisplayLookup({
	query: getCachedQuality,
	probeKey: getCacheDisplayProbeKey,
	contextKey: () => JSON.stringify([cacheRevisionStore.getValue(), qualityStore.getValue()]),
})
