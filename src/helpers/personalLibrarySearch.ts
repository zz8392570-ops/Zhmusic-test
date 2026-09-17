import type { Track } from '@/player/types'

export type LibraryCollection = {
	id: string
	title?: string
	name?: string
	songs?: Track[]
	tracks?: Track[]
}
export type LibraryTrackResult = { track: Track; collections: { id: string; title: string }[] }

const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
export function searchPersonalLibrary(collections: LibraryCollection[], query: string) {
	const keyword = normalize(query)
	const tracks = new Map<string, LibraryTrackResult>()
	const playlists = collections.filter((collection) =>
		normalize([collection.title, collection.name].filter(Boolean).join(' ')).includes(keyword),
	)
	if (!keyword) return { playlists, tracks: [] as LibraryTrackResult[] }
	for (const collection of collections) {
		for (const track of collection.songs ?? collection.tracks ?? []) {
			if (
				!normalize([track.title, track.artist, track.album].filter(Boolean).join(' ')).includes(
					keyword,
				)
			)
				continue
			const key = JSON.stringify([track.platform ?? 'unknown', track.id])
			const result = tracks.get(key) ?? { track, collections: [] }
			if (!result.collections.some((item) => item.id === collection.id)) {
				result.collections.push({
					id: collection.id,
					title: collection.title || collection.name || '',
				})
			}
			tracks.set(key, result)
		}
	}
	return { playlists, tracks: [...tracks.values()] }
}
