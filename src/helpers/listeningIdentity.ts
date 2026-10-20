import type { Track } from '@/player/types'
import { getFavoriteIndex, normalizeFavoriteGroups } from './favoriteGroups'

export const listeningTrackKey = (track: Track) => JSON.stringify([track.platform, track.id])

/** Group at read time, so splitting favorites can recover the original platform totals. */
export const getListeningRecordingIndex = (tracks: Track[], favorites: readonly Track[]) => {
	const favoriteIndex = getFavoriteIndex(favorites)
	return getFavoriteIndex(
		normalizeFavoriteGroups(tracks.map((track) => favoriteIndex.find(track) ?? track)),
	)
}
