import { unknownTrackImageUri } from '@/constants/images'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import { formatSingerName } from '@/components/utils/musicSdk/utils'

export type ParsedPlaylistLink = {
	source: MusicPlatform
	id: string
}

const SOURCE_ALIASES: Record<string, MusicPlatform> = {
	tx: 'tx',
	qq: 'tx',
	kw: 'kw',
	kuwo: 'kw',
	kg: 'kg',
	kugou: 'kg',
	wy: 'wy',
	netease: 'wy',
	'163': 'wy',
	mg: 'mg',
	migu: 'mg',
}

const toHttps = (url?: string | null) => {
	if (!url) return unknownTrackImageUri
	const href = String(url)
	if (href.startsWith('//')) return `https:${href}`
	if (href.startsWith('/')) return `https://d.musicapp.migu.cn${href}`
	return href.replace(/^http:/, 'https:').replace('{size}', '400')
}

const fetchJson = async (url: string, headers?: Record<string, string>) => {
	const response = await fetch(url, { headers })
	if (!response.ok) throw new Error(`HTTP ${response.status}`)
	return response.json()
}

const firstMatch = (text: string, patterns: RegExp[]) => {
	for (const pattern of patterns) {
		const match = text.match(pattern)
		if (match?.[1]) return match[1]
	}
	return null
}

export const parsePlaylistInput = (raw: string): ParsedPlaylistLink | null => {
	const text = raw.trim()
	if (!text) return null

	const prefixed = text.match(/^(tx|qq|kw|kuwo|kg|kugou|wy|netease|163|mg|migu)[:\s/_-]+(\d+)$/i)
	if (prefixed) {
		return { source: SOURCE_ALIASES[prefixed[1].toLowerCase()], id: prefixed[2] }
	}

	const lower = text.toLowerCase()

	if (/music\.163\.com|y\.music\.163\.com/.test(lower)) {
		const id = firstMatch(text, [/[?&#]id=(\d+)/, /playlist\/(\d+)/])
		return id ? { source: 'wy', id } : null
	}

	if (/y\.qq\.com|i\.y\.qq\.com|c\.y\.qq\.com/.test(lower)) {
		const id = firstMatch(text, [/[?&]id=(\d+)/, /playlist\/(\d+)/, /disstid=(\d+)/])
		return id ? { source: 'tx', id } : null
	}

	if (/kuwo\.cn/.test(lower)) {
		const id = firstMatch(text, [/playlist_detail\/(\d+)/, /[?&]pid=(\d+)/, /[?&]id=(\d+)/])
		return id ? { source: 'kw', id } : null
	}

	if (/kugou\.com/.test(lower)) {
		const id = firstMatch(text, [
			/special\/single\/(\d+)/,
			/plist\/list\/(\d+)/,
			/songlist\/(\d+)/,
			/specialid=(\d+)/,
			/[?&]id=(\d+)/,
		])
		return id ? { source: 'kg', id } : null
	}

	if (/migu\.cn/.test(lower)) {
		const id = firstMatch(text, [/playlistId=(\d+)/, /playlist\/(\d+)/, /[?&]id=(\d+)/])
		return id ? { source: 'mg', id } : null
	}

	if (/^\d+$/.test(text)) return null
	return null
}

const toTrack = (
	source: MusicPlatform,
	item: {
		id: string | number
		songmid?: string | number
		hash?: string
		copyrightId?: string
		title: string
		artist: string
		album?: string
		artwork?: string | null
		duration?: number
		albumid?: string | number
	},
): IMusic.IMusicItem => ({
	id: String(item.songmid ?? item.id),
	platform: source,
	songmid: String(item.songmid ?? item.id),
	hash: item.hash,
	copyrightId: item.copyrightId,
	title: item.title || 'Untitled Song',
	artist: item.artist || 'Unknown Artist',
	album: item.album || '',
	artwork: toHttps(item.artwork),
	duration: Number(item.duration) || 0,
	url: 'Unknown',
	albumid: item.albumid,
})

const toPlaylist = (
	source: MusicPlatform,
	id: string,
	meta: { name: string; artist?: string; artwork?: string | null },
	songs: IMusic.IMusicItem[],
): IMusic.PlayList => ({
	id: `${source}__${id}`,
	platform: source,
	artist: meta.artist || '',
	name: meta.name,
	title: meta.name,
	artwork: toHttps(meta.artwork),
	songs,
})

const importTx = async (id: string): Promise<IMusic.PlayList> => {
	let cd: any
	try {
		const data = await fetchJson(
			`https://c.y.qq.com/v8/fcg-bin/fcg_v8_playlist_cp.fcg?newsong=1&id=${id}&format=json&inCharset=GB2312&outCharset=utf-8`,
		)
		cd = data?.data?.cdlist?.[0]
	} catch {}
	if (!cd?.songlist) {
		const data = await fetchJson(
			`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${id}&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0`,
			{ Referer: 'https://y.qq.com/' },
		)
		cd = data?.cdlist?.[0]
	}
	if (!cd?.songlist) throw new Error('qq playlist empty')
	const songs = cd.songlist.map((item: any) =>
		toTrack('tx', {
			id: item.mid || item.songmid,
			songmid: item.mid || item.songmid,
			title: item.title || item.songname,
			artist: formatSingerName(item.singer, 'name') || 'Unknown Artist',
			album: item.album?.name || item.albumname,
			artwork: item.album?.mid
				? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album.mid}.jpg`
				: item.albummid
					? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.albummid}.jpg`
					: item.singer?.[0]?.mid
						? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
						: null,
			duration: item.interval || 0,
			albumid: item.album?.mid || item.albummid,
		}),
	)
	return toPlaylist(
		'tx',
		id,
		{
			name: cd.dissname || '未命名歌单',
			artist: cd.nickname,
			artwork: cd.logo,
		},
		songs,
	)
}

const importWy = async (id: string): Promise<IMusic.PlayList> => {
	const data = await fetchJson(`https://music.163.com/api/playlist/detail?id=${id}`, {
		Referer: 'https://music.163.com/',
		'User-Agent': 'Mozilla/5.0',
	})
	const result = data?.result
	const tracks = result?.tracks
	if (!tracks?.length) throw new Error('wy playlist empty')
	const songs = tracks.map((item: any) =>
		toTrack('wy', {
			id: item.id,
			title: item.name,
			artist: (item.artists || item.ar || []).map((artist: any) => artist.name).join('、'),
			album: item.album?.name || item.al?.name,
			artwork: item.album?.picUrl || item.al?.picUrl,
			duration: Math.round((item.duration ?? item.dt ?? 0) / 1000),
			albumid: item.album?.id || item.al?.id,
		}),
	)
	return toPlaylist(
		'wy',
		id,
		{
			name: result.name || '未命名歌单',
			artist: result.creator?.nickname,
			artwork: result.coverImgUrl,
		},
		songs,
	)
}

const importKw = async (id: string): Promise<IMusic.PlayList> => {
	const pageSize = 100
	let page = 0
	let total = Infinity
	const musiclist: any[] = []
	let meta: any = null
	while (musiclist.length < total && page < 20) {
		const body = await fetchJson(
			`http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=${page}&rn=${pageSize}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.0.5.0_W1&newver=1`,
		)
		if (body.result && body.result !== 'ok') throw new Error('kw playlist failed')
		if (!meta) meta = body
		total = Number(body.total || body.musiclist?.length || 0)
		musiclist.push(...(body.musiclist || []))
		if (!(body.musiclist || []).length) break
		page += 1
	}
	if (!musiclist.length) throw new Error('kw playlist empty')
	const songs = musiclist.map((item) =>
		toTrack('kw', {
			id: item.id,
			title: item.name,
			artist: String(item.artist || '').replace(/&/g, '、'),
			album: item.album,
			artwork: item.albumpic || item.artistPic || item.musicPic,
			duration: Number(item.duration) || 0,
			albumid: item.albumid,
		}),
	)
	return toPlaylist(
		'kw',
		id,
		{
			name: meta.title || '未命名歌单',
			artist: meta.uname,
			artwork: meta.pic,
		},
		songs,
	)
}

const importKg = async (id: string): Promise<IMusic.PlayList> => {
	const info = await fetchJson(
		`http://mobilecdnbj.kugou.com/api/v5/special/info?specialid=${id}&plat=0&version=9108`,
	)
	const pageSize = 100
	let page = 1
	let total = Infinity
	const items: any[] = []
	while (items.length < total && page <= 20) {
		const body = await fetchJson(
			`http://mobilecdnbj.kugou.com/api/v3/special/song?specialid=${id}&page=${page}&pagesize=${pageSize}&plat=0&version=9108`,
		)
		const list = body?.data?.info ?? []
		total = Number(body?.data?.total || list.length)
		items.push(...list)
		if (!list.length) break
		page += 1
	}
	if (!items.length) throw new Error('kg playlist empty')
	const songs = items.map((item) => {
		const filename = String(item.filename || '')
		const separator = filename.indexOf(' - ')
		const artist = separator > 0 ? filename.slice(0, separator) : item.singername || ''
		const title = separator > 0 ? filename.slice(separator + 3) : filename
		return toTrack('kg', {
			id: item.audio_id || item.hash,
			songmid: item.audio_id || item.hash,
			hash: item.hash,
			title,
			artist,
			album: item.remark || '',
			artwork: item.trans_param?.union_cover,
			duration: Number(item.duration) || 0,
			albumid: item.album_id,
		})
	})
	const data = info?.data || {}
	return toPlaylist(
		'kg',
		id,
		{
			name: data.specialname || '未命名歌单',
			artist: data.nickname || data.singername,
			artwork: data.imgurl || data.user_avatar,
		},
		songs,
	)
}

const importMg = async (id: string): Promise<IMusic.PlayList> => {
	const headers = {
		Referer: 'https://m.music.migu.cn/',
		'User-Agent':
			'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
	}
	const info = await fetchJson(
		`https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId=${id}`,
		headers,
	)
	const pageSize = 50
	let page = 1
	let total = Infinity
	const songList: any[] = []
	while (songList.length < total && page <= 20) {
		const body = await fetchJson(
			`https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=${pageSize}&playlistId=${id}`,
			headers,
		)
		const list = body?.data?.songList ?? []
		total = Number(body?.data?.totalCount || list.length)
		songList.push(...list)
		if (!list.length) break
		page += 1
	}
	if (!songList.length) throw new Error('mg playlist empty')
	const songs = songList.map((item) =>
		toTrack('mg', {
			id: item.songId,
			copyrightId: item.copyrightId,
			title: item.songName,
			artist: (item.singerList ?? []).map((singer: any) => singer.name).join('、'),
			album: item.album,
			artwork: item.img3 || item.img2 || item.img1,
			duration: Number(item.duration) || 0,
			albumid: item.albumId,
		}),
	)
	const data = info?.data || {}
	return toPlaylist(
		'mg',
		id,
		{
			name: data.title || '未命名歌单',
			artist: data.ownerName,
			artwork: data.imgItem?.img || data.originalImgUrl,
		},
		songs,
	)
}

const importers: Record<MusicPlatform, (id: string) => Promise<IMusic.PlayList>> = {
	tx: importTx,
	kw: importKw,
	kg: importKg,
	wy: importWy,
	mg: importMg,
}

export const importPlaylistByLink = async (
	input: string,
	fallbackSource?: MusicPlatform,
): Promise<IMusic.PlayList> => {
	const trimmed = input.trim()
	const parsed =
		parsePlaylistInput(trimmed) ||
		(/^\d+$/.test(trimmed) && fallbackSource
			? { source: fallbackSource, id: trimmed }
			: null)
	if (!parsed) {
		throw new Error('unrecognized playlist link')
	}
	return importers[parsed.source](parsed.id)
}
