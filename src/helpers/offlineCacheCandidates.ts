import type { Track } from '@/player/types'
import {
	getFavoriteIndex,
	getFavoriteRecordingKey,
	getFavoriteVariants,
	isSameFavoriteRecording,
} from './favoriteGroups'
const identity = (track: Track) => JSON.stringify([track.platform, track.id])
const original = (track: Track): Track => ({ ...track, id: track.originalId || track.id })
type Index = { exact: Map<string, Track[]>; metadata: Map<string, Track[]> }
const indexes = new WeakMap<readonly Track[], Index>()
const libraryIndex = (tracks: readonly Track[]) => {
	const existing = indexes.get(tracks)
	if (existing) return existing
	const index: Index = { exact: new Map(), metadata: new Map() }
	for (const track of tracks) {
		const item = original(track)
		for (const [map, key] of [
			[index.exact, identity(item)],
			[index.metadata, getFavoriteRecordingKey(item)],
		] as const) {
			if (!key) continue
			const bucket = map.get(key) ?? []
			bucket.push(item)
			map.set(key, bucket)
		}
	}
	indexes.set(tracks, index)
	return index
}
/** Provider identities and compatible recordings only; never guess from a title alone. */
export function getOfflineCacheCandidates(
	track: Track,
	favorites: readonly Track[],
	library: readonly Track[],
): Track[] {
	const favoriteIndex = getFavoriteIndex(favorites)
	const withPreference = (item: Track) => ({
		...item,
		favoriteKeepSeparate:
			item.favoriteKeepSeparate || favoriteIndex.find(item)?.favoriteKeepSeparate,
	})
	const root = withPreference(original(track))
	const owner = favoriteIndex.find(root) ?? track
	const variants = [
		root,
		...getFavoriteVariants(owner).filter((item) =>
			isSameFavoriteRecording(root, withPreference(item)),
		),
	]
	const index = libraryIndex(library)
	const candidates: Track[] = []
	const seen = new Set([JSON.stringify([track.platform, track.id, track.url, track.cachedQuality])])
	const add = (item: Track) => {
		const key = JSON.stringify([item.platform, item.id, item.url, item.cachedQuality])
		if (!seen.has(key)) {
			seen.add(key)
			candidates.push(item)
		}
	}
	for (const variant of variants) {
		add(variant)
		for (const item of index.exact.get(identity(variant)) ?? []) add(item)
		for (const item of index.metadata.get(getFavoriteRecordingKey(variant)) ?? []) {
			if (isSameFavoriteRecording(withPreference(variant), withPreference(item))) add(item)
		}
	}
	return candidates
}
