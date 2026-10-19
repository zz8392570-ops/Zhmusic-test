import PersistStatus from '@/store/PersistStatus'
import { getLibraryTrackKey } from './libraryEdits'

export type RecycleEntry = {
	id: string
	deletedAt: number
	kind: 'playlist' | 'songs'
	playlist: IMusic.PlayList
}
const LIFETIME = 30 * 86400_000
export const getRecycleEntries = (now = Date.now()) =>
	(PersistStatus.get('library.recycleBin') ?? [])
		.filter((entry) => entry.deletedAt > now - LIFETIME)
		.slice(0, 100)

/** Save recovery data before destructive changes; failed library writes roll recovery data back. */
export const persistPlaylistsWithRecovery = (
	before: IMusic.PlayList[],
	next: IMusic.PlayList[],
) => {
	const previousTrash = PersistStatus.get('library.recycleBin') ?? []
	const additions: RecycleEntry[] = []
	const nextById = new Map(next.map((item) => [item.id, item]))
	for (const playlist of before) {
		const current = nextById.get(playlist.id)
		if (current === playlist) continue
		const remaining = new Set(current?.songs.map(getLibraryTrackKey) ?? [])
		const removed = playlist.songs.filter((song) => !remaining.has(getLibraryTrackKey(song)))
		if (current && !removed.length) continue
		additions.push({
			id: `recycle-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			deletedAt: Date.now(),
			kind: current ? 'songs' : 'playlist',
			playlist: JSON.parse(
				JSON.stringify({ ...playlist, songs: current ? removed : playlist.songs }),
			),
		})
	}
	if (!additions.length) {
		PersistStatus.set('music.playLists', next)
		return
	}
	PersistStatus.set('library.recycleBin', [...additions, ...getRecycleEntries()].slice(0, 100))
	try {
		PersistStatus.set('music.playLists', next)
	} catch (error) {
		PersistStatus.set('library.recycleBin', previousTrash)
		throw error
	}
}

export const restoreRecycleEntry = (id: string, playlists: IMusic.PlayList[]) => {
	const entries = getRecycleEntries()
	const entry = entries.find((item) => item.id === id)
	if (!entry) throw new Error('Recovery entry expired')
	const existing = playlists.find((item) => item.id === entry.playlist.id)
	const keys = new Set(existing?.songs.map(getLibraryTrackKey) ?? [])
	const restored = existing
		? {
				...existing,
				songs: [
					...existing.songs,
					...entry.playlist.songs.filter((song) => !keys.has(getLibraryTrackKey(song))),
				],
			}
		: { ...entry.playlist }
	const next = existing
		? playlists.map((item) => (item.id === existing.id ? restored : item))
		: [...playlists, restored]
	PersistStatus.set('music.playLists', next)
	try {
		PersistStatus.set(
			'library.recycleBin',
			entries.filter((item) => item.id !== id),
		)
	} catch (error) {
		PersistStatus.set('music.playLists', playlists)
		throw error
	}
	return next
}
