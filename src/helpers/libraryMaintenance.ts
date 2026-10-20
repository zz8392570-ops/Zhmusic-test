import PersistStatus from '@/store/PersistStatus'
import { replaceFavorites, useLibraryStore } from '@/store/library'
import { playListsStore } from '@/player/PlayerStore'
import { mergeLibraryRepairs, mergePlaylistRepairs, copyLibraryTracks } from './libraryEdits'
import { retainedSnapshots, type LibrarySnapshot } from './librarySnapshots'
import type { LibraryRepairResult } from './libraryRepair'

export const getMaintenanceTarget = (id: string) => {
	if (id === 'favorites')
		return { songs: useLibraryStore.getState().favorites, playlist: undefined }
	const playlist = (playListsStore.getValue() ?? []).find((item) => item.id === id)
	if (!playlist) throw new Error('Library target no longer exists')
	return { songs: playlist.songs, playlist }
}
const saveTarget = (id: string, songs: IMusic.IMusicItem[], playlist?: IMusic.PlayList) => {
	if (id === 'favorites') replaceFavorites(songs)
	else {
		const current = playListsStore.getValue() ?? []
		const next = current.some((item) => item.id === id)
			? current.map((item) => (item.id === id ? { ...playlist!, songs } : item))
			: [...current, { ...playlist!, songs }]
		PersistStatus.set('music.playLists', next)
		playListsStore.setValue(next)
	}
}
export const applyLibraryRepair = (
	id: string,
	baseline: IMusic.IMusicItem[],
	replacements: LibraryRepairResult['replacements'],
) => {
	const current = getMaintenanceTarget(id)
	const merged = current.playlist
		? mergePlaylistRepairs(current.playlist, baseline, replacements)
		: mergeLibraryRepairs(baseline, current.songs, replacements)
	if (!merged.repaired) return 0
	const songs = 'songs' in merged ? merged.songs : merged.tracks
	saveTarget(
		id,
		songs,
		current.playlist
			? {
					...current.playlist,
					sourceOverrides:
						'sourceOverrides' in merged ? merged.sourceOverrides : current.playlist.sourceOverrides,
				}
			: undefined,
	)
	return merged.repaired
}
export const snapshotTargetFingerprint = (snapshot: LibrarySnapshot) => {
	try {
		return JSON.stringify(getMaintenanceTarget(snapshot.target))
	} catch {
		return 'missing'
	}
}
export const restoreLibrarySnapshot = (id: string, expectedFingerprint: string) => {
	const snapshot = retainedSnapshots(PersistStatus.get('library.snapshots') ?? []).find(
		(item) => item.id === id,
	)
	if (!snapshot || snapshotTargetFingerprint(snapshot) !== expectedFingerprint) return false
	saveTarget(snapshot.target, copyLibraryTracks(snapshot.songs), snapshot.playlist)
	return true
}
