import musicSdk from '@/components/utils/musicSdk'
import { unknownTrackImageUri } from '@/constants/images'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import type { Playlist } from '@/helpers/types'
import { getTopLists } from '@/helpers/userApi/getMusicSource'
import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'
import { normalizeArtworkUrl } from '@/helpers/artworkResolver'
export { resolveLeaderboardArtwork } from '@/helpers/artworkResolver'

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
	getLeaderboardBoards(source).map((board) =>
		toRadioPlaylist(source, board.bangid, board.name, unknownTrackImageUri),
	)

const toHttps = (url?: string | null) => {
	if (!url) return unknownTrackImageUri
	return normalizeArtworkUrl(url)
}

const getEmbeddedTrackArtwork = (track: any, source: LeaderboardSource) => {
	const candidates = [
		track.artwork,
		track.img,
		track.pic,
		track.cover,
		track.coverImg,
		track.album_sizable_cover,
		track.trans_param?.union_cover,
		track.album?.picUrl,
		track.al?.picUrl,
		track.albumImgs?.[0]?.img,
	]
	const embedded = candidates.find((value) => typeof value === 'string' && value.trim())
	if (embedded) return normalizeArtworkUrl(embedded)

	const albumId = track.albumId ?? track.albumid
	if (source === 'tx' && albumId) {
		return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`
	}
	return unknownTrackImageUri
}

const toRadioPlaylist = (
	source: LeaderboardSource,
	bangid: string | number,
	title: string,
	coverImg?: string | null,
	extra?: Partial<Playlist>,
): Playlist => {
	const cover = toHttps(coverImg)
	return {
		id: `${source}__${bangid}`,
		title,
		name: title,
		coverImg: cover,
		artwork: cover,
		artworkPreview: cover,
		singerImg: cover,
		period: extra?.period || '',
		description: extra?.description || '',
		platform: source,
		artist: '',
		tracks: extra?.tracks || [],
		songs: extra?.songs || [],
	}
}

const fetchJson = async (url: string, headers?: Record<string, string>) => {
	const response = await fetch(url, { headers })
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	return response.json()
}

const fetchTxRadio = async (): Promise<Playlist[]> => {
	const groups = await getTopLists()
	return groups.flatMap((group: { data?: any[] }) =>
		(group.data ?? []).map((item) =>
			toRadioPlaylist('tx', item.id, item.title, item.coverImg, {
				period: item.period,
				description: item.description,
			}),
		),
	)
}

const flattenKwBoards = (node: any, acc: Playlist[] = [], seen = new Set<string>()) => {
	const list = Array.isArray(node) ? node : node ? [node] : []
	for (const item of list) {
		const bangid = String(item.sourceid || '')
		if (item.source == '1' && bangid && !seen.has(bangid)) {
			seen.add(bangid)
			acc.push(toRadioPlaylist('kw', bangid, item.name, item.pic))
		}
		if (item.child) flattenKwBoards(item.child, acc, seen)
	}
	return acc
}

const fetchKwRadio = async (): Promise<Playlist[]> => {
	const tree = await fetchJson(
		'https://qukudata.kuwo.cn/q.k?op=query&cont=tree&node=2&pn=0&rn=1000&fmt=json&level=2',
	)
	const list = flattenKwBoards(tree.child || tree)
	if (!list.length) throw new Error('empty kw boards')
	return list
}

const fetchKgRadio = async (): Promise<Playlist[]> => {
	const result = await fetchJson(
		'http://mobilecdnbj.kugou.com/api/v5/rank/list?version=9108&plat=0&showtype=2&parentid=0&apiver=6&area_code=1&withsong=1',
	)
	const list = (result?.data?.info ?? [])
		.filter((item: any) => item.isvol == 1 && item.rankid)
		.map((item: any) =>
			toRadioPlaylist('kg', item.rankid, item.rankname, item.imgurl || item.banner7url),
		)
	if (!list.length) throw new Error('empty kg boards')
	return list
}

const fetchWyRadio = async (): Promise<Playlist[]> => {
	const result = await fetchJson('https://music.163.com/api/toplist', {
		Referer: 'https://music.163.com/',
		'User-Agent': 'Mozilla/5.0',
	})
	const list = (result?.list ?? []).map((item: any) =>
		toRadioPlaylist('wy', item.id, item.name, item.coverImgUrl),
	)
	if (!list.length) throw new Error('empty wy boards')
	return list
}

const collectMgRanks = (nodes: any[], acc: Playlist[] = [], seen = new Set<string>()) => {
	for (const item of nodes) {
		const bangid = String(item.rankId || '')
		if (bangid && !seen.has(bangid)) {
			seen.add(bangid)
			acc.push(toRadioPlaylist('mg', bangid, item.rankName, item.imageUrl))
		}
		if (Array.isArray(item.contents)) collectMgRanks(item.contents, acc, seen)
	}
	return acc
}

const fetchMgRadio = async (): Promise<Playlist[]> => {
	const result = await fetchJson('https://app.c.nf.migu.cn/pc/bmw/rank/rank-index/v1.0', {
		Referer: 'https://app.c.nf.migu.cn/',
		channel: '0146921',
	})
	const list = collectMgRanks(result?.data?.contents ?? [])
	if (!list.length) throw new Error('empty mg boards')
	return list
}

const radioFetchers: Record<LeaderboardSource, () => Promise<Playlist[]>> = {
	tx: fetchTxRadio,
	kw: fetchKwRadio,
	kg: fetchKgRadio,
	wy: fetchWyRadio,
	mg: fetchMgRadio,
}

export const fetchRadioPlaylists = async (source: LeaderboardSource): Promise<Playlist[]> => {
	try {
		const list = await radioFetchers[source]()
		if (list.length) return list
	} catch (error) {
		console.error('Failed to fetch radio boards:', error)
	}
	return boardsToPlaylists(source)
}

export const mapLeaderboardTrack = (track: any, source: LeaderboardSource): Track => ({
	id: String(track.songmid ?? ''),
	platform: source,
	songmid: String(track.songmid ?? ''),
	songId: track.songId,
	strMediaMid: track.strMediaMid,
	hash: track.hash,
	qualities: track._types,
	copyrightId: track.copyrightId,
	url: track.url || 'Unknown',
	title: track.name || 'Untitled Song',
	artist: track.singer || 'Unknown Artist',
	album: track.albumName || 'Unknown Album',
	albumid: track.albumId,
	genre: track.genre || 'Unknown Genre',
	date: track.releaseDate || 'Unknown Release Date',
	artwork: getEmbeddedTrackArtwork(track, source),
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
