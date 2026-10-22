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

const identity = (track: Track) => JSON.stringify([track.platform, track.id])

export const mergeSelectedFavorites = (
	baseline: Track[],
	selected: Set<string>,
	options: { allowReview?: boolean } = {},
) => {
	const current = useLibraryStore.getState().favorites as Track[]
	const candidates = getFavoriteMergeCandidates(baseline).filter(
		(group) => (!group.review || options.allowReview === true) && selected.has(group.id),
	)
	const byIdentity = new Map<string, number[]>()
	current.forEach((track, index) => {
		const key = identity(track)
		const indexes = byIdentity.get(key) ?? []
		indexes.push(index)
		byIdentity.set(key, indexes)
	})
	const replacements = new Map<number, Track>()
	const removed = new Set<number>()
	const undoGroups: { before: number[]; after: Track }[] = []
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
		const before = indexes.map((index) => current[index])
		const after = mergeFavoriteGroup(before)
		replacements.set(indexes[0], after)
		undoGroups.push({ before: indexes, after })
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
		groups: undoGroups.map((group) => ({
			before: group.before,
			after: next.indexOf(group.after),
		})),
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
	if (!undo) return false
	const current = useLibraryStore.getState().favorites
	let next = undo.before
	if (JSON.stringify(current) !== JSON.stringify(undo.after)) {
		// Older recovery records remain usable when the complete snapshot still matches.
		if (!undo.groups?.length) return false
		const replacements = new Map<number, IMusic.IMusicItem[]>()
		const owners = new Map<string, Set<number>>()
		for (const [index, item] of current.entries()) {
			for (const variant of getFavoriteVariants(item)) {
				const key = identity(variant)
				const indexes = owners.get(key) ?? new Set<number>()
				indexes.add(index)
				owners.set(key, indexes)
			}
		}
		for (const group of undo.groups) {
			const merged = undo.after[group.after]
			const matches = [...(owners.get(identity(merged)) ?? [])].filter((index) =>
				isUneditedLibraryTrack(current[index], merged),
			)
			if (matches.length !== 1 || replacements.has(matches[0])) return false
			const index = matches[0]
			// Do not restore copies of a platform version that has since been added elsewhere.
			if (
				getFavoriteVariants(merged).some((variant) => {
					const indexes = owners.get(identity(variant))
					return indexes && (indexes.size !== 1 || !indexes.has(index))
				})
			)
				return false
			replacements.set(
				index,
				group.before.map((originalIndex) => undo.before[originalIndex]),
			)
		}
		next = current.flatMap((item, index) => replacements.get(index) ?? [item])
	}
	PersistStatus.set('music.favoriteMergeUndo', undefined)
	try {
		replaceFavorites(next)
	} catch (error) {
		PersistStatus.set('music.favoriteMergeUndo', undo)
		throw error
	}
	return true
}

/** The group's primary record is also its persisted default playback source. */
export const preferFavoriteSource = (track: Track, source: Track): Track | undefined => {
	const current = useLibraryStore.getState().favorites as Track[]
	const index = current.findIndex((item) => isFavoriteTrack(item, track))
	if (index < 0) return undefined
	const favorite = current[index]
	const variants = getFavoriteVariants(favorite)
	const selected = variants.find(
		(item) => item.id === source.id && item.platform === source.platform,
	)
	if (!selected) return undefined
	if (favorite.id === selected.id && favorite.platform === selected.platform) return favorite
	const preferred = mergeFavoriteGroup([
		selected,
		...variants.filter((item) => item.id !== selected.id || item.platform !== selected.platform),
	])
	replaceFavorites(
		current.map((item, i) => (i === index ? preferred : item)) as IMusic.IMusicItem[],
	)
	return preferred
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

export const removeFavoriteVariant = (track: Track, source: Track) => {
	const current = useLibraryStore.getState().favorites as Track[]
	const index = current.findIndex((item) => isFavoriteTrack(item, track))
	if (index < 0) return false
	const variants = getFavoriteVariants(current[index])
	const next = variants.filter((item) => item.id !== source.id || item.platform !== source.platform)
	if (!next.length || next.length === variants.length) return false
	const replacement = next.length === 1 ? next[0] : mergeFavoriteGroup(next)
	replaceFavorites(
		current.map((item, i) => (i === index ? replacement : item)) as IMusic.IMusicItem[],
	)
	return true
}
