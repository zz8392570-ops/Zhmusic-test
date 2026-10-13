import { getBoardSongs, mapLeaderboardTrack, type LeaderboardSource } from '@/helpers/leaderboard'
import type { Track } from '@/player/types'

export type LeaderboardPage = {
	tracks: Track[]
	total: number
	page: number
	hasMore: boolean
}

export const getLeaderboardPage = async (
	source: LeaderboardSource,
	boardId: string,
	page = 1,
): Promise<LeaderboardPage> => {
	const result = await getBoardSongs(source, boardId, page)
	const tracks = (result.list ?? []).map((item) => mapLeaderboardTrack(item, source))
	const rawLimit = Number(result.limit)
	const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : tracks.length || 100
	const offset = (page - 1) * limit
	const rawTotal = Number(result.total)
	const total = Math.max(
		offset + tracks.length,
		Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : 0,
	)
	return {
		tracks,
		total,
		page,
		hasMore: tracks.length > 0 && offset + tracks.length < total,
	}
}

export const appendLeaderboardTracks = (previous: Track[], next: Track[]): Track[] => {
	const seen = new Set(previous.map((track) => JSON.stringify([track.platform, track.id])))
	return [
		...previous,
		...next.filter((track) => {
			const key = JSON.stringify([track.platform, track.id])
			if (seen.has(key)) return false
			seen.add(key)
			return true
		}),
	]
}

// Do not replace a user's current queue with a partial chart after a later page fails.
export const getFullLeaderboard = async (
	source: LeaderboardSource,
	boardId: string,
	isCurrent: () => boolean = () => true,
): Promise<Track[]> => {
	let tracks: Track[] = []
	for (let page = 1; page <= 100; page++) {
		if (!isCurrent()) throw new Error('Leaderboard request cancelled')
		const result = await getLeaderboardPage(source, boardId, page)
		if (!isCurrent()) throw new Error('Leaderboard request cancelled')
		if (page > 1 && !result.tracks.length) throw new Error('Leaderboard page is incomplete')
		const combined = appendLeaderboardTracks(tracks, result.tracks)
		if (page > 1 && combined.length === tracks.length) {
			throw new Error('Leaderboard provider repeated the previous page')
		}
		tracks = combined
		if (!result.hasMore) return tracks
	}
	throw new Error('Leaderboard page limit exceeded')
}
