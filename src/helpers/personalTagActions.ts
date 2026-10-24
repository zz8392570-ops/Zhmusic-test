import PersistStatus from '@/store/PersistStatus'
import { getLibraryTrackKey } from './libraryEdits'
import {
	addTagsToTracks,
	personalTracks,
	renameTag,
	normalizeTags,
	isValidTagCollections,
	type TagCollection,
} from './personalFeatures'

export function tagSelectedSongs(selected: ReadonlySet<string>, labels: string[]) {
	const favorites = PersistStatus.get('music.favorites') ?? []
	const tracks = personalTracks(
		favorites,
		PersistStatus.get('music.playLists') ?? [],
		PersistStatus.get('music.importedLocalMusic') ?? [],
	).filter((track) => selected.has(getLibraryTrackKey(track)))
	if (!tracks.length || !normalizeTags(labels).length) throw Error('No selection or tags')
	const next = addTagsToTracks(
		tracks,
		PersistStatus.get('music.trackTags') ?? {},
		labels,
		favorites,
	)
	PersistStatus.set('music.trackTags', next)
	return tracks.length
}
export function renameLibraryTag(from: string, to: string) {
	const before = PersistStatus.get('music.trackTags') ?? {}
	const collections = PersistStatus.get('music.tagCollections') ?? []
	const next = renameTag(before, from, to)
	const renamed = collections.map((item) => ({
		...item,
		tags: normalizeTags(
			item.tags.map((tag) => (tag.toLocaleLowerCase() === from.toLocaleLowerCase() ? to : tag)),
		),
	}))
	if (!isValidTagCollections(renamed)) throw Error('Invalid filters')
	try {
		PersistStatus.set('music.trackTags', next)
		PersistStatus.set('music.tagCollections', renamed)
	} catch (error) {
		try {
			PersistStatus.set('music.trackTags', before)
			PersistStatus.set('music.tagCollections', collections)
		} catch {
			/* Storage unavailable. */
		}
		throw error
	}
}
export function saveTagCollection(name: string, tags: string[], matchAll: boolean) {
	const item: TagCollection = {
		id: `tags:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		name: name.trim(),
		tags: normalizeTags(tags),
		matchAll,
	}
	const next = [...(PersistStatus.get('music.tagCollections') ?? []), item]
	if (!isValidTagCollections(next)) throw Error('Invalid dynamic playlist or limit reached')
	PersistStatus.set('music.tagCollections', next)
	return item
}
