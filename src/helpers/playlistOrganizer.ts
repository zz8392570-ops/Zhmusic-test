import type { Track } from '@/player/types'

export type PlaylistSortField = 'title' | 'artist' | 'album' | 'duration' | 'source'

const text = (value: unknown) => String(value ?? '').trim()
const normalized = (value: unknown) =>
	text(value)
		.normalize('NFKC')
		.toLocaleLowerCase()
		.replace(/[\s·•・._'’"-]+/g, '')

const normalizedArtists = (value: unknown) =>
	text(value)
		.split(/[、,，/&＆]+/)
		.map(normalized)
		.filter(Boolean)
		.sort()
		.join('|')

const compareText = (left: unknown, right: unknown) =>
	text(left).localeCompare(text(right), undefined, { numeric: true, sensitivity: 'base' })

export const sortPlaylistTracks = (tracks: Track[], field: PlaylistSortField): Track[] =>
	tracks
		.map((track, index) => ({ track, index }))
		.sort((left, right) => {
			let result = 0
			switch (field) {
				case 'duration':
					result = Number(left.track.duration || 0) - Number(right.track.duration || 0)
					break
				case 'source':
					result = compareText(left.track.platform, right.track.platform)
					break
				default:
					result = compareText(left.track[field], right.track[field])
			}
			return result || left.index - right.index
		})
		.map(({ track }) => track)

/** Keep the first strict title/artist/duration match and return later copies for review. */
export const findDuplicateTrackIds = (tracks: Track[]): Set<string> => {
	const groups = new Map<string, Track[]>()
	const duplicates = new Set<string>()
	for (const track of tracks) {
		const title = normalized(track.title)
		const artists = normalizedArtists(track.artist)
		if (!title || !artists) continue
		const key = `${title}::${artists}`
		const candidates = groups.get(key) ?? []
		const duration = Number(track.duration || 0)
		const matches = candidates.some((candidate) => {
			const candidateDuration = Number(candidate.duration || 0)
			return !duration || !candidateDuration || Math.abs(duration - candidateDuration) <= 4
		})
		if (matches) duplicates.add(track.id)
		else candidates.push(track)
		groups.set(key, candidates)
	}
	return duplicates
}

export type RankedReplacement = { track: Track; score: number }

export const rankReplacementSourcesWithScore = (
	current: Track,
	results: Track[],
): RankedReplacement[] => {
	const candidates = results.flatMap((item) => [item, ...(item.sourceAlternatives ?? [])])
	const unique = new Map<string, Track>()
	for (const candidate of candidates) {
		const key = `${candidate.platform ?? 'unknown'}::${candidate.id}`
		if (candidate.id && key !== `${current.platform ?? 'unknown'}::${current.id}`)
			unique.set(key, candidate)
	}
	const title = normalized(current.title)
	const artists = normalizedArtists(current.artist)
	const duration = Number(current.duration || 0)
	return [...unique.values()]
		.map((track, index) => {
			let score = 0
			if (normalized(track.title) === title) score += 8
			if (normalizedArtists(track.artist) === artists) score += 6
			const candidateDuration = Number(track.duration || 0)
			if (duration && candidateDuration && Math.abs(duration - candidateDuration) <= 4) score += 3
			return { track, index, score }
		})
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.map(({ track, score }) => ({ track, score }))
}

export const rankReplacementSources = (current: Track, results: Track[]): Track[] =>
	rankReplacementSourcesWithScore(current, results).map(({ track }) => track)
