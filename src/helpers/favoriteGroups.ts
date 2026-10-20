import type { Track } from '@/player/types'

const key = (track: Track) => JSON.stringify([track.platform, track.id])
const text = (value: unknown) =>
	String(value ?? '')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\s·•・._'’"-]+/g, '')
const metadataKey = (track: Track) => {
	const title = text(track.title)
	const artist = String(track.artist ?? '')
		.split(/[、,，/&＆]+/)
		.map(text)
		.filter(Boolean)
		.sort()
		.join('|')
	return title &&
		artist &&
		!/^(unknown|未知|未知歌手|未知歌曲|未知艺术家)$/.test(title) &&
		!/^(unknown|未知|未知歌手|未知歌曲|未知艺术家)$/.test(artist)
		? JSON.stringify([title, artist])
		: ''
}
const version = (track: Track) =>
	[
		...new Set(
			`${track.title ?? ''} ${track.album ?? ''} ${track.alias ?? ''}`
				.toLowerCase()
				.match(
					/live|现场|演唱会|remix|混音|伴奏|instrumental|acoustic|不插电|demo|翻唱|cover|remaster|重制|重录|纯音乐|karaoke/g,
				) ?? [],
		),
	]
		.sort()
		.join('|')
const duration = (track: Track) =>
	Number.isFinite(Number(track.duration)) && Number(track.duration) > 0 ? Number(track.duration) : 0
const standalone = (track: Track): Track => {
	const { sourceAlternatives: _alternatives, availablePlatforms: _platforms, ...rest } = track
	void _alternatives
	void _platforms
	return rest
}
const validVariant = (value: unknown): value is Track =>
	!!value &&
	typeof value === 'object' &&
	typeof (value as Track).id === 'string' &&
	typeof (value as Track).platform === 'string' &&
	typeof (value as Track).title === 'string' &&
	typeof (value as Track).artist === 'string'

export const getFavoriteVariants = (track: Track): Track[] => {
	const variants = [
		track,
		...(Array.isArray(track.sourceAlternatives)
			? track.sourceAlternatives.filter(validVariant)
			: []),
	]
	const unique = new Map<string, Track>()
	for (const item of variants) if (!unique.has(key(item))) unique.set(key(item), standalone(item))
	return [...unique.values()]
}

/** Only complete, compatible recordings may be linked automatically. Local files remain separate. */
export const isSameFavoriteRecording = (left: Track, right: Track): boolean => {
	if (key(left) === key(right)) return true
	return (
		!left.favoriteKeepSeparate &&
		!right.favoriteKeepSeparate &&
		left.platform !== 'local' &&
		right.platform !== 'local' &&
		left.platform !== right.platform &&
		version(left) === version(right) &&
		!!metadataKey(left) &&
		metadataKey(left) === metadataKey(right) &&
		!!duration(left) &&
		!!duration(right) &&
		Math.abs(duration(left) - duration(right)) <= 4
	)
}
const canMerge = (left: Track, right: Track) =>
	getFavoriteVariants(left).every((a) =>
		getFavoriteVariants(right).every((b) => isSameFavoriteRecording(a, b)),
	)

export const mergeFavoriteGroup = (tracks: Track[]): Track => {
	const variants = new Map<string, Track>()
	for (const track of tracks)
		for (const variant of getFavoriteVariants(track)) {
			if (!variants.has(key(variant))) variants.set(key(variant), variant)
		}
	const [primary, ...sourceAlternatives] = variants.values()
	return {
		...primary,
		sourceAlternatives,
		availablePlatforms: [
			...new Set([primary, ...sourceAlternatives].map((item) => item.platform!)),
		],
	}
}
export const isFavoriteTrack = (favorite: Track, track: Track) =>
	getFavoriteVariants(favorite).some((variant) => key(variant) === key(track))

type FavoriteIndex = {
	has: (track: Track | null | undefined) => boolean
	find: (track: Track | null | undefined) => Track | undefined
}
const favoriteIndexes = new WeakMap<readonly Track[], FavoriteIndex>()

/** Favorite arrays are immutable snapshots. All rows share one index until that snapshot changes. */
export const getFavoriteIndex = (favorites: readonly Track[]): FavoriteIndex => {
	const cached = favoriteIndexes.get(favorites)
	if (cached) return cached
	const owners = new Map<string, Track>()
	const add = (variant: Track, owner: Track) => {
		const identity = key(variant)
		if (!owners.has(identity)) owners.set(identity, owner)
	}
	for (const favorite of favorites) {
		add(favorite, favorite)
		if (Array.isArray(favorite.sourceAlternatives)) {
			for (const variant of favorite.sourceAlternatives) {
				if (validVariant(variant)) add(variant, favorite)
			}
		}
	}
	const index: FavoriteIndex = {
		has: (track) => !!track && owners.has(key(track)),
		find: (track) => (track ? owners.get(key(track)) : undefined),
	}
	favoriteIndexes.set(favorites, index)
	return index
}

export const addFavoriteTrack = (favorites: Track[], track: Track): Track[] => {
	const index = favorites.findIndex((item) => isFavoriteTrack(item, track) || canMerge(item, track))
	if (index < 0) return [...favorites, track]
	return favorites.map((item, i) => (i === index ? mergeFavoriteGroup([item, track]) : item))
}
export const toggleFavoriteTrack = (favorites: Track[], track: Track): Track[] => {
	if (favorites.some((item) => isFavoriteTrack(item, track)))
		return favorites.filter((item) => !isFavoriteTrack(item, track))
	return addFavoriteTrack(favorites, track)
}
export const normalizeFavoriteGroups = (tracks: Track[]) => {
	const result: Track[] = []
	const identities = new Map<string, number>()
	const names = new Map<string, Set<number>>()
	for (const track of tracks) {
		const name = metadataKey(track)
		const exact = identities.get(key(track))
		const index = exact ?? [...(names.get(name) ?? [])].find((i) => canMerge(result[i], track))
		const target = index ?? result.length
		if (index === undefined) result.push(track)
		else result[index] = mergeFavoriteGroup([result[index], track])
		for (const variant of getFavoriteVariants(result[target])) identities.set(key(variant), target)
		if (name) {
			const bucket = names.get(name) ?? new Set<number>()
			bucket.add(target)
			names.set(name, bucket)
		}
	}
	return result
}

export type FavoriteMergeCandidate = { id: string; tracks: Track[]; review: boolean }
export const getFavoriteMergeCandidates = (favorites: Track[]): FavoriteMergeCandidate[] => {
	const buckets = new Map<string, Track[]>()
	for (const track of favorites) {
		const name = metadataKey(track)
		if (!name || track.platform === 'local' || track.favoriteKeepSeparate) continue
		const bucket = buckets.get(name) ?? []
		bucket.push(track)
		buckets.set(name, bucket)
	}
	const result: FavoriteMergeCandidate[] = []
	for (const tracks of buckets.values()) {
		const groups: Track[][] = []
		for (const track of tracks) {
			const group = groups.find((items) => items.every((item) => canMerge(item, track)))
			if (group) group.push(track)
			else groups.push([track])
		}
		for (const group of groups)
			if (group.length > 1) result.push({ id: key(group[0]), tracks: group, review: false })
		if (
			tracks.length > 1 &&
			tracks.some((track) => !duration(track)) &&
			new Set(tracks.map((track) => track.platform)).size > 1
		)
			result.push({ id: `review:${key(tracks[0])}`, tracks, review: true })
	}
	return result
}
