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
// Build once per library snapshot; typing only compares pre-normalized strings.
export function createPersonalLibrarySearch(collections: LibraryCollection[]) {
	const indexed = collections.map((collection) => ({
		collection,
		text: normalize([collection.title, collection.name].filter(Boolean).join(' ')),
		tracks: (collection.songs ?? collection.tracks ?? []).map((track) => ({
			track,
			key: JSON.stringify([track.platform ?? 'unknown', track.id]),
			text: normalize([track.title, track.artist, track.album].filter(Boolean).join(' ')),
		})),
	}))
	return (query: string) => {
		const keyword = normalize(query)
		const playlists = indexed
			.filter((item) => item.text.includes(keyword))
			.map((item) => item.collection)
		const tracks = new Map<string, LibraryTrackResult>()
		if (!keyword) return { playlists, tracks: [] as LibraryTrackResult[] }
		for (const { collection, tracks: entries } of indexed) {
			for (const { track, key, text } of entries) {
				if (!text.includes(keyword)) continue
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
}

// Compatibility for one-off callers. Repeated searches should reuse an index.
export function searchPersonalLibrary(collections: LibraryCollection[], query: string) {
	return createPersonalLibrarySearch(collections)(query)
}
