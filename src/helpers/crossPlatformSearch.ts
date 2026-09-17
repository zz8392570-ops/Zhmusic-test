import { decodeName } from '@/components/utils/common'
import { toMD5 } from '@/components/utils/musicSdk/utils'
import { unknownTrackImageUri } from '@/constants/images'
import type { Track } from '@/player/types'
import { searchMusic } from './userApi/xiaoqiu'
import { waitForRequest } from './requestControl'

export type MusicPlatform = 'tx' | 'kw' | 'kg' | 'wy' | 'mg'
export type SearchPlatform = 'all' | MusicPlatform

export const MUSIC_PLATFORMS: MusicPlatform[] = ['tx', 'kw', 'kg', 'wy', 'mg']

type PlatformSearchResult = {
	data: Track[]
	hasMore: boolean
}

export type CrossPlatformSearchResult = PlatformSearchResult & {
	unavailablePlatforms: MusicPlatform[]
	pendingPlatforms?: MusicPlatform[]
}

export type SearchProgressHandler = (result: CrossPlatformSearchResult) => void

const SEARCH_TIMEOUT_MS = 10_000
const ALL_PLATFORM_PAGE_SIZE = 10
const SINGLE_PLATFORM_PAGE_SIZE = 20

const formatBytes = (value: unknown) => {
	const bytes = Number(value)
	if (!Number.isFinite(bytes) || bytes <= 0) return undefined
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const fetchJson = async (url: string, options: RequestInit = {}) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
	try {
		const response = await fetch(url, { ...options, signal: controller.signal })
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return JSON.parse(await response.text())
	} finally {
		clearTimeout(timer)
	}
}

const parseKuwoQualities = (qualityText: string | undefined) => {
	const qualities: Record<string, { size?: string }> = {}
	for (const quality of qualityText?.split(';') ?? []) {
		const match = /bitrate:(\d+),format:(\w+),size:([\w.]+)/.exec(quality)
		if (!match) continue
		if (match[1] === '2000') qualities.flac = { size: match[3].toUpperCase() }
		if (match[1] === '320') qualities['320k'] = { size: match[3].toUpperCase() }
		if (match[1] === '128') qualities['128k'] = { size: match[3].toUpperCase() }
	}
	return qualities
}

const searchTx = async (
	query: string,
	page: number,
	limit: number,
): Promise<PlatformSearchResult> => {
	const result = await searchMusic(query, page, limit)
	return {
		data: result.data.map((track) => ({ ...track, platform: 'tx' })) as Track[],
		hasMore: !result.isEnd,
	}
}

const searchKw = async (
	query: string,
	page: number,
	limit: number,
): Promise<PlatformSearchResult> => {
	const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(query)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`
	const result = await fetchJson(url)
	const total = Number(result?.TOTAL ?? 0)
	const data = (result?.abslist ?? [])
		.map((item: any): Track | null => {
			const id = String(item.MUSICRID ?? item.DC_TARGETID ?? '').replace('MUSIC_', '')
			if (!id) return null
			const artworkPath = String(item.web_albumpic_short ?? '').replace(/^\d+\//, '')
			return {
				id,
				platform: 'kw',
				title: decodeName(item.SONGNAME || item.NAME || ''),
				artist: decodeName(item.ARTIST || ''),
				album: decodeName(item.ALBUM || ''),
				albumid: item.ALBUMID,
				artwork: artworkPath
					? `https://img1.kuwo.cn/star/albumcover/500/${artworkPath}`
					: unknownTrackImageUri,
				duration: Number(item.DURATION) || 0,
				url: 'Unknown',
				songmid: id,
				qualities: parseKuwoQualities(item.N_MINFO) as IMusic.IQuality,
			}
		})
		.filter(Boolean) as Track[]

	return { data, hasMore: page * limit < total }
}

const searchKg = async (
	query: string,
	page: number,
	limit: number,
): Promise<PlatformSearchResult> => {
	const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(query)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`
	const result = await fetchJson(url)
	if (result?.error_code !== 0) throw new Error(result?.error_msg || 'Kugou search failed')
	const total = Number(result?.data?.total ?? 0)
	const seen = new Set<string>()
	const data = (result?.data?.lists ?? [])
		.flatMap((item: any) => [item, ...(item.Grp ?? [])])
		.map((item: any): Track | null => {
			const hash = String(item.FileHash ?? '')
			const id = String(item.Audioid ?? item.MixSongID ?? hash)
			const uniqueKey = `${id}-${hash}`
			if (!id || seen.has(uniqueKey)) return null
			seen.add(uniqueKey)
			const cover = String(item.Image || item.trans_param?.union_cover || '').replace(
				'{size}',
				'400',
			)
			const qualities: Record<string, { size?: string; hash?: string }> = {}
			if (item.FileSize) qualities['128k'] = { size: formatBytes(item.FileSize), hash }
			if (item.HQFileSize) {
				qualities['320k'] = { size: formatBytes(item.HQFileSize), hash: item.HQFileHash }
			}
			if (item.SQFileSize) {
				qualities.flac = { size: formatBytes(item.SQFileSize), hash: item.SQFileHash }
			}

			return {
				id,
				platform: 'kg',
				title: decodeName(
					`${item.OriSongName || item.SongName || ''}${item.Suffix ? ` ${item.Suffix}` : ''}`,
				),
				artist: decodeName(
					(item.Singers ?? [])
						.map((singer: any) => singer.name)
						.filter(Boolean)
						.join('、') ||
						item.SingerName ||
						'',
				),
				album: decodeName(item.AlbumName || ''),
				albumid: item.AlbumID,
				artwork: cover ? cover.replace(/^http:/, 'https:') : unknownTrackImageUri,
				duration: Number(item.Duration) || 0,
				url: 'Unknown',
				songmid: id,
				hash,
				qualities: qualities as IMusic.IQuality,
			}
		})
		.filter(Boolean) as Track[]

	return { data, hasMore: page * limit < total }
}

const searchWy = async (
	query: string,
	page: number,
	limit: number,
): Promise<PlatformSearchResult> => {
	const offset = (page - 1) * limit
	const url = `https://music.163.com/api/search/get?s=${encodeURIComponent(query)}&type=1&offset=${offset}&limit=${limit}`
	const result = await fetchJson(url, {
		headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
	})
	if (result?.code !== 200) throw new Error('NetEase search failed')
	const total = Number(result?.result?.songCount ?? 0)
	const data = (result?.result?.songs ?? []).map((item: any): Track => {
		const qualities: Record<string, { size?: string }> = {}
		if (item.bMusic || item.lMusic) {
			qualities['128k'] = { size: formatBytes((item.bMusic || item.lMusic)?.size) }
		}
		if (item.hMusic || item.mMusic) {
			qualities['320k'] = { size: formatBytes((item.hMusic || item.mMusic)?.size) }
		}

		return {
			id: String(item.id),
			platform: 'wy',
			title: item.name || '',
			artist: (item.artists ?? [])
				.map((artist: any) => artist.name)
				.filter(Boolean)
				.join('、'),
			album: item.album?.name || '',
			albumid: item.album?.id,
			artwork: item.album?.picUrl || unknownTrackImageUri,
			duration: Math.round(Number(item.duration ?? 0) / 1000),
			url: 'Unknown',
			songmid: String(item.id),
			qualities: qualities as IMusic.IQuality,
		}
	})

	return { data, hasMore: page * limit < total }
}

const searchMg = async (
	query: string,
	page: number,
	limit: number,
): Promise<PlatformSearchResult> => {
	const timestamp = Date.now().toString()
	const deviceId = '963B7AA0D21511ED807EE5846EC87D20'
	const signatureSeed = '6cdc72a439cef99a3418d2a78aa28c73'
	const sign = toMD5(
		`${query}${signatureSeed}yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${timestamp}`,
	)
	const url = `https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D&pageSize=${limit}&text=${encodeURIComponent(query)}&pageNo=${page}&sort=0&sid=USS`
	const result = await fetchJson(url, {
		headers: {
			uiVersion: 'A_music_3.6.1',
			deviceId,
			timestamp,
			sign,
			channel: '0146921',
			'User-Agent': 'Mozilla/5.0 (Linux; Android 11)',
		},
	})
	if (result?.code !== '000000') throw new Error(result?.info || 'Migu search failed')
	const songData = result?.songResultData ?? { resultList: [], totalCount: 0 }
	const seen = new Set<string>()
	const data = (songData.resultList ?? [])
		.flat()
		.map((item: any): Track | null => {
			const id = String(item.songId ?? '')
			const copyrightId = String(item.copyrightId ?? '')
			if (!id || !copyrightId || seen.has(copyrightId)) return null
			seen.add(copyrightId)
			const qualities: Record<string, { size?: string }> = {}
			for (const quality of item.audioFormats ?? []) {
				const size = formatBytes(quality.asize ?? quality.isize)
				if (quality.formatType === 'PQ') qualities['128k'] = { size }
				if (quality.formatType === 'HQ') qualities['320k'] = { size }
				if (quality.formatType === 'SQ') qualities.flac = { size }
			}
			let artwork = item.img3 || item.img2 || item.img1 || ''
			if (artwork && !/^https?:/.test(artwork)) artwork = `https://d.musicapp.migu.cn${artwork}`

			return {
				id,
				platform: 'mg',
				title: item.name || '',
				artist: (item.singerList ?? [])
					.map((singer: any) => singer.name)
					.filter(Boolean)
					.join('、'),
				album: item.album || '',
				albumid: item.albumId,
				artwork: artwork || unknownTrackImageUri,
				duration: Number(item.duration) || 0,
				url: 'Unknown',
				songmid: id,
				copyrightId,
				lrcUrl: item.lrcUrl,
				lyricUrl: item.lyricUrl,
				ext: item.ext,
				mrcUrl: item.mrcurl,
				trcUrl: item.trcUrl,
				qualities: qualities as IMusic.IQuality,
			}
		})
		.filter(Boolean) as Track[]

	return { data, hasMore: page * limit < Number(songData.totalCount ?? 0) }
}

const platformSearchers: Record<
	MusicPlatform,
	(query: string, page: number, limit: number) => Promise<PlatformSearchResult>
> = {
	tx: searchTx,
	kw: searchKw,
	kg: searchKg,
	wy: searchWy,
	mg: searchMg,
}

const normalizeSearchText = (value: unknown) =>
	String(value ?? '')
		.normalize('NFKC')
		.toLocaleLowerCase()
		.replace(/[\s·•・._'’"-]+/g, '')

const normalizeArtists = (value: unknown) =>
	String(value ?? '')
		.split(/[、,，/&＆]+/)
		.map(normalizeSearchText)
		.filter(Boolean)
		.sort()
		.join('|')

const getDeduplicationKey = (track: Track) => {
	const title = normalizeSearchText(track.title)
	const artists = normalizeArtists(track.artist)
	return title && artists ? `${title}::${artists}` : `${track.platform ?? 'unknown'}::${track.id}`
}

const isCompatibleDuration = (left: Track, right: Track) => {
	const leftDuration = Number(left.duration || 0)
	const rightDuration = Number(right.duration || 0)
	return !leftDuration || !rightDuration || Math.abs(leftDuration - rightDuration) <= 4
}

const asStandaloneTrack = (track: Track): Track => {
	const item = { ...track }
	delete item.sourceAlternatives
	delete item.availablePlatforms
	return item
}

const mergeDuplicateGroup = (tracks: Track[]): Track => {
	const unique = new Map<string, Track>()
	for (const track of tracks.flatMap((item) => [item, ...(item.sourceAlternatives ?? [])])) {
		const standalone = asStandaloneTrack(track)
		unique.set(`${standalone.platform ?? 'unknown'}::${standalone.id}`, standalone)
	}
	// The first displayed recording keeps its identity and position as slower
	// platforms arrive. Other recordings remain available in its source menu.
	const ordered = Array.from(unique.values())
	const [primary, ...sourceAlternatives] = ordered
	return {
		...primary,
		sourceAlternatives,
		availablePlatforms: Array.from(
			new Set(ordered.map((item) => String(item.platform ?? '')).filter(Boolean)),
		),
	}
}

/**
 * Collapse only strict title + complete artist matches. Duration keeps live/remix recordings
 * separate, while every original result remains available from the song's source menu.
 */
export const deduplicateCrossPlatformTracks = (tracks: Track[]): Track[] => {
	const groups = new Map<string, Track[][]>()
	const orderedGroups: Track[][] = []
	for (const track of tracks) {
		const key = getDeduplicationKey(track)
		const candidates = groups.get(key) ?? []
		const matchingGroup = candidates.find((group) => isCompatibleDuration(group[0], track))
		if (matchingGroup) matchingGroup.push(track)
		else {
			const group = [track]
			candidates.push(group)
			orderedGroups.push(group)
		}
		groups.set(key, candidates)
	}
	return orderedGroups.map(mergeDuplicateGroup)
}

export const searchSongsAcrossPlatforms = async (
	query: string,
	page: number,
	platform: SearchPlatform,
	onProgress?: SearchProgressHandler,
): Promise<CrossPlatformSearchResult> => {
	if (platform !== 'all') {
		const result = await waitForRequest(
			() => platformSearchers[platform](query, page, SINGLE_PLATFORM_PAGE_SIZE),
			SEARCH_TIMEOUT_MS,
		)
		return { ...result, unavailablePlatforms: [] }
	}

	let data: Track[] = []
	let hasMore = false
	let successCount = 0
	const unavailablePlatforms: MusicPlatform[] = []
	const pending = new Set(MUSIC_PLATFORMS)
	const snapshot = (): CrossPlatformSearchResult => ({
		data,
		hasMore,
		unavailablePlatforms: [...unavailablePlatforms],
		pendingPlatforms: [...pending],
	})
	await Promise.all(
		MUSIC_PLATFORMS.map(async (source) => {
			try {
				const result = await waitForRequest(
					() => platformSearchers[source](query, page, ALL_PLATFORM_PAGE_SIZE),
					SEARCH_TIMEOUT_MS,
				)
				successCount++
				data = deduplicateCrossPlatformTracks([...data, ...result.data])
				hasMore ||= result.hasMore
			} catch {
				unavailablePlatforms.push(source)
			} finally {
				pending.delete(source)
				onProgress?.(snapshot())
			}
		}),
	)
	if (successCount === 0) throw new Error('All music platforms failed to search')
	return snapshot()
}
