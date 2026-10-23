import type { Track } from '@/player/types'
import { getFavoriteIndex } from './favoriteGroups'
import type { ListeningStatsRecord } from './listeningStats'
const key = (track: Track) =>
	JSON.stringify([
		track.platform,
		track.platform === 'local' ? track.id : track.originalId || track.id,
	])
/** Weighted sampling without replacement: every queue entry survives exactly once. */
export function smartShuffle<T extends Track>(
	tracks: readonly T[],
	records: readonly ListeningStatsRecord[],
	favorites: readonly Track[],
	random = Math.random,
	now = Date.now(),
): T[] {
	const index = getFavoriteIndex(favorites),
		times = new Map<string, number>()
	const identity = (track: Track) => key(index.find(track) ?? track)
	for (const record of records) {
		const id = identity(record.track)
		if (Number.isFinite(record.lastPlayedAt))
			times.set(id, Math.max(times.get(id) ?? 0, record.lastPlayedAt))
	}
	return tracks
		.map((track, position) => {
			const last = times.get(identity(track)),
				age = last === undefined ? Infinity : Math.max(0, now - last)
			const weight =
				age < 24 * 3600_000
					? 0.15
					: age < 7 * 86400_000
						? 0.6
						: index.has(track) && age >= 30 * 86400_000
							? 2
							: 1
			const value = Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()))
			return { track, position, score: -Math.log(value) / weight }
		})
		.sort((a, b) => a.score - b.score || a.position - b.position)
		.map((item) => item.track)
}
