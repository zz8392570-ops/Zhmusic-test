import type { Track } from '@/player/types'
import { getFavoriteIndex, getFavoriteVariants, isSameFavoriteRecording } from './favoriteGroups'
type Playlist = { id: string; name?: string; title?: string; songs?: Track[] }
const identity = (track: Track) =>
	JSON.stringify([
		track.platform,
		track.platform === 'local' ? track.id : track.originalId || track.id,
	])
type Collection = { id: string; title: string }
const indexes = new WeakMap<readonly Playlist[], Map<string, Collection[]>>()
function collectionIndex(playlists: readonly Playlist[]) {
	const cached = indexes.get(playlists)
	if (cached) return cached
	const index = new Map<string, Collection[]>()
	for (const playlist of playlists) {
		for (const track of playlist.songs ?? []) {
			for (const variant of getFavoriteVariants(track)) {
				const key = identity(variant),
					bucket = index.get(key) ?? []
				if (!bucket.some((item) => item.id === playlist.id))
					bucket.push({ id: playlist.id, title: playlist.title || playlist.name || '' })
				index.set(key, bucket)
			}
		}
	}
	indexes.set(playlists, index)
	return index
}
/** Exact provider identities and explicitly grouped versions; never infer library membership from a title alone. */
export function getTrackLibraryMembership(
	track: Track,
	favorites: readonly Track[],
	playlists: readonly Playlist[],
) {
	const favoriteIndex = getFavoriteIndex(favorites)
	const stored = favoriteIndex.find(track)
	const versions = stored
		? getFavoriteVariants(stored)
		: getFavoriteVariants(track).filter(
				(item) => identity(item) === identity(track) || isSameFavoriteRecording(track, item),
			)
	const found = new Map<string, Collection>()
	const index = collectionIndex(playlists)
	for (const item of versions)
		for (const collection of index.get(identity(item)) ?? []) found.set(collection.id, collection)
	return {
		favorite: !!stored,
		otherFavorite: !stored && versions.some((item) => favoriteIndex.has(item)),
		collections: [...found.values()],
	}
}
