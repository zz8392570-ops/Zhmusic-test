import type { Track } from '@/player/types'

export type DislikeRule = { id: string; kind: 'song' | 'artist'; title?: string; artist: string }
const normalize = (value: string) =>
	value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
const validText = (value: unknown): value is string =>
	typeof value === 'string' && !!value.trim() && value.length <= 500
export const getDislikeArtistCredit = (track: Track): string =>
	Array.isArray(track.artist)
		? track.artist.filter((artist) => typeof artist === 'string').join('、')
		: typeof track.artist === 'string'
			? track.artist
			: ''

/** Keep names such as AC/DC intact; split explicit collaboration separators only. */
export const getDislikeArtists = (track: Track): string[] => {
	const values = Array.isArray(track.artist) ? track.artist : [track.artist]
	const artists = values.flatMap((value) =>
		typeof value === 'string'
			? value
					.split(/、|[;,；，]|\s+(?:&|\/|feat\.?|ft\.?|featuring)\s+/i)
					.map((name) => name.trim())
					.filter(validText)
			: [],
	)
	return [...new Map(artists.map((artist) => [normalize(artist), artist])).values()]
}
export function createDislikeRule(
	kind: DislikeRule['kind'],
	artist: string,
	title?: string,
): DislikeRule | null {
	if (!validText(artist) || (kind === 'song' && !validText(title))) return null
	return {
		id: JSON.stringify([kind, kind === 'song' ? normalize(title!) : '', normalize(artist)]),
		kind,
		artist: artist.trim(),
		...(kind === 'song' ? { title: title!.trim() } : {}),
	}
}
export const isValidDislikeRules = (value: unknown): value is DislikeRule[] =>
	Array.isArray(value) &&
	value.length <= 5000 &&
	value.every(
		(rule) =>
			rule &&
			typeof rule === 'object' &&
			(rule.kind === 'song' || rule.kind === 'artist') &&
			typeof rule.id === 'string' &&
			!!createDislikeRule(rule.kind, rule.artist, rule.title),
	)
export const normalizeDislikeRules = (value: unknown): DislikeRule[] => {
	if (!Array.isArray(value)) return []
	const rules = value.slice(0, 5000).flatMap((rule) => {
		if (!rule || (rule.kind !== 'song' && rule.kind !== 'artist')) return []
		const parsed = createDislikeRule(rule.kind, rule.artist, rule.title)
		return parsed ? [parsed] : []
	})
	return [...new Map(rules.map((rule) => [rule.id, rule])).values()]
}
export function createDislikeMatcher(rules: DislikeRule[]) {
	const songs = new Set(
		rules
			.filter((rule) => rule.kind === 'song')
			.map((rule) => JSON.stringify([normalize(rule.title!), normalize(rule.artist)])),
	)
	const artists = new Set(
		rules.filter((rule) => rule.kind === 'artist').map((rule) => normalize(rule.artist)),
	)
	return (track: Track) => {
		if (
			typeof track.title === 'string' &&
			songs.has(JSON.stringify([normalize(track.title), normalize(getDislikeArtistCredit(track))]))
		)
			return true
		return getDislikeArtists(track).some((artist) => artists.has(normalize(artist)))
	}
}
