import type { Track } from '@/player/types'
import { getFavoriteIndex, getFavoriteVariants, isSameFavoriteRecording } from './favoriteGroups'

const key = (track: Track) => JSON.stringify([track.platform, track.id])

export const isPlaybackQueueTrack = (track: Track, current?: Track | null) =>
	!!current &&
	(key(track) === key(current) ||
		(!!current.playbackQueueOrigin && key(track) === key(current.playbackQueueOrigin)))

export type FavoritePlayback = {
	root: Track
	variants: Track[]
	exhausted: Set<string>
	resumePosition: number
	started: boolean
}

export const createFavoritePlayback = (
	track: Track,
	favorites: readonly Track[],
): FavoritePlayback => {
	const owner = getFavoriteIndex(favorites).find(track) ?? track
	const variants =
		track.platform === 'local'
			? [track]
			: [
					track,
					...getFavoriteVariants(owner).filter(
						(item) =>
							key(item) !== key(track) &&
							item.platform !== 'local' &&
							isSameFavoriteRecording(track, item),
					),
				]
	return { root: track, variants, exhausted: new Set(), resumePosition: 0, started: false }
}

export const containsPlaybackVariant = (playback: FavoritePlayback, track: Track) =>
	playback.variants.some((item) => key(item) === key(track))

export const nextPlaybackVariant = (
	playback: FavoritePlayback,
	failed: Track,
): Track | undefined => {
	playback.exhausted.add(key(failed))
	return playback.variants.find((item) => !playback.exhausted.has(key(item)))
}
