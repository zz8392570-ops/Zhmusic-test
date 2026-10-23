import type { Track } from '@/player/types'
import { getFavoriteIndex, getFavoriteVariants } from './favoriteGroups'
export type ListeningScene = {
	id: string
	name: string
	collectionId: string
	shuffle: boolean
	offlineOnly: boolean
	sleepMinutes: number
}
export type TrackTags = Record<string, string[]>
export const personalTrackKey = (track: Track) =>
	JSON.stringify([
		track.platform,
		track.platform === 'local' ? track.id : track.originalId || track.id,
	])
const validId = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= 1024 &&
	![...value].some((char) => char.charCodeAt(0) < 32)
export const isValidScenes = (value: unknown): value is ListeningScene[] =>
	Array.isArray(value) &&
	value.length <= 20 &&
	new Set(value.map((item) => item?.id)).size === value.length &&
	value.every(
		(item) =>
			item &&
			validId(item.id) &&
			typeof item.name === 'string' &&
			item.name.trim().length > 0 &&
			item.name.length <= 40 &&
			validId(item.collectionId) &&
			typeof item.shuffle === 'boolean' &&
			typeof item.offlineOnly === 'boolean' &&
			Number.isInteger(item.sleepMinutes) &&
			item.sleepMinutes >= 0 &&
			item.sleepMinutes <= 180,
	)
export const normalizeTags = (value: string[]) => [
	...new Map(
		value
			.map((tag) => tag.normalize('NFKC').trim().replace(/\s+/g, ' '))
			.filter(Boolean)
			.map((tag) => [tag.toLocaleLowerCase(), tag]),
	).values(),
]
export const isValidTrackTags = (value: unknown): value is TrackTags => {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length > 5000
	)
		return false
	return Object.entries(value).every(([key, tags]) => {
		try {
			const ids = JSON.parse(key)
			if (
				!Array.isArray(ids) ||
				ids.length !== 2 ||
				!ids.every(validId) ||
				JSON.stringify(ids) !== key
			)
				return false
		} catch {
			return false
		}
		return (
			Array.isArray(tags) &&
			tags.length <= 16 &&
			tags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 32) &&
			JSON.stringify(normalizeTags(tags)) === JSON.stringify(tags)
		)
	})
}
export function getTrackTags(track: Track, tags: TrackTags, favorites: readonly Track[] = []) {
	const owner = getFavoriteIndex(favorites).find(track) ?? track
	return normalizeTags(
		getFavoriteVariants(owner).flatMap((item) => tags[personalTrackKey(item)] ?? []),
	)
}
export function updateTrackTags(
	track: Track,
	tags: TrackTags,
	values: string[],
	favorites: readonly Track[] = [],
): TrackTags {
	const normalized = normalizeTags(values)
	const owner = getFavoriteIndex(favorites).find(track) ?? track
	const next = { ...tags }
	// Editing a grouped song replaces its group's labels, so removed labels cannot reappear from an alternative.
	for (const variant of getFavoriteVariants(owner)) delete next[personalTrackKey(variant)]
	if (normalized.length) next[personalTrackKey(owner)] = normalized
	if (!isValidTrackTags(next)) throw new Error('Invalid tags or tag limit reached')
	return next
}
export function personalTracks(
	favorites: readonly Track[],
	playlists: readonly { songs?: Track[] }[],
	local: readonly Track[],
) {
	const index = getFavoriteIndex(favorites),
		found = new Map<string, Track>()
	for (const track of [...favorites, ...playlists.flatMap((item) => item.songs ?? []), ...local]) {
		const owner = index.find(track) ?? track
		if (!found.has(personalTrackKey(owner))) found.set(personalTrackKey(owner), owner)
	}
	return [...found.values()]
}
export const defaultScenes = (commute: string, sleep: string): ListeningScene[] => [
	{
		id: 'commute',
		name: commute,
		collectionId: 'favorites',
		shuffle: true,
		offlineOnly: true,
		sleepMinutes: 0,
	},
	{
		id: 'sleep',
		name: sleep,
		collectionId: 'favorites',
		shuffle: false,
		offlineOnly: false,
		sleepMinutes: 30,
	},
]
