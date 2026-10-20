import type { Track } from '@/player/types'
import { getFavoriteIndex, isSameFavoriteRecording } from './favoriteGroups'

export const sameDownloadRecording = (left: Track, right: Track, favorites: readonly Track[]) => {
	const index = getFavoriteIndex(favorites)
	const original = (track: Track) => ({ ...track, id: track.originalId || track.id })
	const a = original(left),
		b = original(right)
	const ownerA = index.find(a),
		ownerB = index.find(b)
	return (!!ownerA && ownerA === ownerB) || isSameFavoriteRecording(ownerA ?? a, ownerB ?? b)
}
export const reusableDownloadQuality = (actual: string, requested: string, strict: boolean) => {
	const ranks: Record<string, number> = { '128k': 1, '320k': 2, flac: 3 }
	return strict ? actual === requested : !!ranks[actual] && ranks[actual] >= ranks[requested]
}
