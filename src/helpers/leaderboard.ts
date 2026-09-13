import musicSdk from '@/components/utils/musicSdk'
import { unknownTrackImageUri } from '@/constants/images'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import type { Playlist } from '@/helpers/types'
import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'

export type LeaderboardSource = MusicPlatform

export const LEADERBOARD_SOURCES: LeaderboardSource[] = ['tx', 'kw', 'kg', 'wy', 'mg']
export const DEFAULT_HOME_SOURCE: LeaderboardSource = 'tx'
export const DEFAULT_HOME_BOARD_ID = '26'
export const DEFAULT_BOARD_IDS: Record<LeaderboardSource, string> = {
	tx: '26',
	kw: '16',
	kg: '8888',
	wy: '3778678',
	mg: '27186466',
}

export type LeaderboardBoard = {
	id: string
	name: string
	bangid: string
}

export const isLeaderboardSource = (value: unknown): value is LeaderboardSource =>
	LEADERBOARD_SOURCES.includes(value as LeaderboardSource)

export const normalizeLeaderboardSource = (value: unknown): LeaderboardSource =>
	isLeaderboardSource(value) ? value : DEFAULT_HOME_SOURCE

export const normalizeBoardId = (value: unknown, source: LeaderboardSource): string => {
	const bangid = value == null ? '' : String(value)
	return bangid || DEFAULT_BOARD_IDS[source]
}

export const getLeaderboardBoards = (source: LeaderboardSource): LeaderboardBoard[] => {
	const leaderboard = musicSdk[source]?.leaderboard
	const list = leaderboard?.boardList ?? leaderboard?.list ?? []
	return list.map((board: { id?: string; name: string; bangid: string | number }) => ({
		id: board.id || `${source}__${board.bangid}`,
		name: board.name,
		bangid: String(board.bangid),
	}))
}

export const getLeaderboardBoardName = (
	source: LeaderboardSource,
	bangid?: string | number | null,
) => {
	const id = normalizeBoardId(bangid, source)
	return getLeaderboardBoards(source).find((board) => board.bangid === id)?.name ?? '热歌榜'
}

export const resolveBoardId = (source: LeaderboardSource, bangid?: string | number | null) => {
	const boards = getLeaderboardBoards(source)
	const id = normalizeBoardId(bangid, source)
	if (boards.some((board) => board.bangid === id)) return id
	return boards[0]?.bangid ?? DEFAULT_BOARD_IDS[source]
}

export const setHomeLeaderboard = (source: LeaderboardSource, bangid?: string | number | null) => {
	PersistStatus.set('music.homeBoardSource', source)
	PersistStatus.set('music.homeBoardId', resolveBoardId(source, bangid))
}

export const parseBoardKey = (
	key: string,
): { source: LeaderboardSource; bangid: string } | null => {
	const separator = key.indexOf('__')
	if (separator <= 0) return null
	const source = key.slice(0, separator)
	const bangid = key.slice(separator + 2)
	if (!isLeaderboardSource(source) || !bangid) return null
	return { source, bangid }
}

export const boardsToPlaylists = (source: LeaderboardSource): Playlist[] =>
	getLeaderboardBoards(source).map((board) => ({
		id: board.id,
		title: board.name,
		name: board.name,
		coverImg: unknownTrackImageUri,
		artwork: unknownTrackImageUri,
		artworkPreview: unknownTrackImageUri,
		singerImg: unknownTrackImageUri,
		period: '',
		description: '',
		platform: source,
		artist: '',
		tracks: [],
		songs: [],
	}))

export const mapLeaderboardTrack = (track: any, source: LeaderboardSource): Track => ({
	id: String(track.songmid ?? ''),
	platform: source,
	songmid: String(track.songmid ?? ''),
	hash: track.hash,
	qualities: track._types,
	source,
	copyrightId: track.copyrightId,
	url: track.url || 'Unknown',
	title: track.name || 'Untitled Song',
	artist: track.singer || 'Unknown Artist',
	album: track.albumName || 'Unknown Album',
	albumid: track.albumId,
	genre: track.genre || 'Unknown Genre',
	date: track.releaseDate || 'Unknown Release Date',
	artwork: track.img || unknownTrackImageUri,
	duration: 0,
	singerImg: track.singerImg || unknownTrackImageUri,
})

export const getBoardSongs = async (
	source: LeaderboardSource,
	bangid: string,
	page = 1,
): Promise<{ list: any[] }> => {
	const leaderboard = musicSdk[source]?.leaderboard
	if (!leaderboard?.getList) {
		throw new Error(`No leaderboard for ${source}`)
	}
	return leaderboard.getList(bangid, page)
}
