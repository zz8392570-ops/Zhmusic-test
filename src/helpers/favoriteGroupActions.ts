import PersistStatus from '@/store/PersistStatus'
import { replaceFavorites, useLibraryStore } from '@/store/library'
import { copyLibraryTracks, isUneditedLibraryTrack } from './libraryEdits'
import {
	getFavoriteMergeCandidates,
	getFavoriteVariants,
	isFavoriteTrack,
	mergeFavoriteGroup,
} from './favoriteGroups'
import type { Track } from '@/player/types'

export const mergeSelectedFavorites = (baseline: Track[], selected: Set<string>) => {
	const current = useLibraryStore.getState().favorites as Track[]
	const candidates = getFavoriteMergeCandidates(baseline).filter(
		(group) => !group.review && selected.has(group.id),
	)
	const byIdentity = new Map<string, number[]>()
	const identity = (track: Track) => JSON.stringify([track.platform, track.id])
	current.forEach((track, index) => {
		const key = identity(track)
		const indexes = byIdentity.get(key) ?? []
		indexes.push(index)
		byIdentity.set(key, indexes)
	})
	const replacements = new Map<number, Track>()
	const removed = new Set<number>()
	let merged = 0
	for (const group of candidates) {
		const indexes: number[] = []
		for (const track of group.tracks) {
			indexes.push(
				(byIdentity.get(identity(track)) ?? []).find(
					(index) =>
						!indexes.includes(index) &&
						!removed.has(index) &&
						!replacements.has(index) &&
						isUneditedLibraryTrack(current[index], track),
				) ?? -1,
			)
		}
		if (indexes.some((index) => index < 0)) continue
		indexes.sort((a, b) => a - b)
		replacements.set(indexes[0], mergeFavoriteGroup(indexes.map((index) => current[index])))
		for (const index of indexes.slice(1)) removed.add(index)
		merged++
	}
	const next = current.flatMap((track, index) =>
		removed.has(index) ? [] : [replacements.get(index) ?? track],
	)
	if (!merged) return 0
	const previousUndo = PersistStatus.get('music.favoriteMergeUndo')
	PersistStatus.set('music.favoriteMergeUndo', {
		before: copyLibraryTracks(current) as IMusic.IMusicItem[],
		after: copyLibraryTracks(next) as IMusic.IMusicItem[],
	})
	try {
		replaceFavorites(next as IMusic.IMusicItem[])
	} catch (error) {
		PersistStatus.set('music.favoriteMergeUndo', previousUndo ?? undefined)
		throw error
	}
	return merged
}
export const undoFavoriteMerge = () => {
	const undo = PersistStatus.get('music.favoriteMergeUndo')
	if (!undo || JSON.stringify(useLibraryStore.getState().favorites) !== JSON.stringify(undo.after))
		return false
	PersistStatus.set('music.favoriteMergeUndo', undefined)
	try {
		replaceFavorites(undo.before)
	} catch (error) {
		PersistStatus.set('music.favoriteMergeUndo', undo)
		throw error
	}
	return true
}
export const splitFavoriteGroup = (track: Track) => {
	const current = useLibraryStore.getState().favorites as Track[]
	const index = current.findIndex((item) => isFavoriteTrack(item, track))
	if (index < 0 || getFavoriteVariants(current[index]).length < 2) return
	const variants = getFavoriteVariants(current[index]).map((item) => ({
		...item,
		favoriteKeepSeparate: true,
	}))
	replaceFavorites(
		current.flatMap((item, i) => (i === index ? variants : [item])) as IMusic.IMusicItem[],
	)
}
