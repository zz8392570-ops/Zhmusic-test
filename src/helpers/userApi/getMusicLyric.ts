import { b64DecodeUnicode, decodeName } from '@/components/utils'
import { logError } from '@/helpers/logger'
import { normalizeMusicPlatform } from '@/helpers/musicPlatform'

const DEFAULT_LYRIC = '[00:00.00]暂无歌词'
const LYRIC_TIMEOUT_MS = 8_000

type LyricSource = ILyric.ILyricSource

const fetchText = async (url: string, options: RequestInit = {}) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), LYRIC_TIMEOUT_MS)
	try {
		const response = await fetch(url, { ...options, signal: controller.signal })
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return await response.text()
	} finally {
		clearTimeout(timer)
	}
}

const fetchJson = async (url: string, options: RequestInit = {}) =>
	JSON.parse(await fetchText(url, options))

const asLyricSource = (value: unknown): LyricSource | null => {
	if (typeof value === 'string' && value.trim()) return { rawLrc: value }
	if (!value || typeof value !== 'object') return null

	const source = value as Record<string, unknown>
	const rawLrc = source.rawLrc ?? source.lyric
	if (typeof rawLrc !== 'string' || !rawLrc.trim()) return null
	const translation = source.translation ?? source.tlyric
	return {
		rawLrc,
		...(typeof translation === 'string' && translation.trim() ? { translation } : {}),
	}
}

const getEmbeddedLyric = (musicItem: IMusic.IMusicItem): LyricSource | null =>
	asLyricSource(musicItem.$localLyric) ??
	asLyricSource(musicItem.lyric) ??
	asLyricSource(musicItem.rawLrc) ??
	(typeof musicItem.lrc === 'string' && musicItem.lrc.includes('[')
		? asLyricSource(musicItem.lrc)
		: null)

const getTxLyric = async (musicItem: IMusic.IMusicItem): Promise<LyricSource> => {
	const songmid = musicItem.songmid || musicItem.id
	const body = await fetchJson(
		`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq`,
		{ headers: { Referer: 'https://y.qq.com/portal/player.html' } },
	)
	if (body?.code !== 0 || !body?.lyric) throw new Error('QQ lyric unavailable')
	return {
		rawLrc: decodeName(b64DecodeUnicode(body.lyric)),
		...(body.trans ? { translation: decodeName(b64DecodeUnicode(body.trans)) } : {}),
	}
}

const formatLrcTime = (secondsValue: unknown) => {
	const seconds = Number(secondsValue)
	if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00'
	const minutes = Math.floor(seconds / 60)
	const remainder = (seconds - minutes * 60).toFixed(2).padStart(5, '0')
	return `${String(minutes).padStart(2, '0')}:${remainder}`
}

const getKwLyric = async (musicItem: IMusic.IMusicItem): Promise<LyricSource> => {
	const id = musicItem.songmid || musicItem.id
	const body = await fetchJson(
		`https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${encodeURIComponent(id)}`,
		{ headers: { Referer: 'https://www.kuwo.cn/', 'User-Agent': 'Mozilla/5.0' } },
	)
	const lines = body?.data?.lrclist
	if (!Array.isArray(lines) || lines.length === 0) throw new Error('Kuwo lyric unavailable')
	return {
		rawLrc: lines
			.map((line: any) => `[${formatLrcTime(line?.time)}]${line?.lineLyric ?? ''}`)
			.join('\n'),
	}
}

const getKgLyric = async (musicItem: IMusic.IMusicItem): Promise<LyricSource> => {
	const keyword = [musicItem.artist, musicItem.title].filter(Boolean).join(' - ')
	const hash = String(musicItem.hash || (musicItem.qualities?.['128k'] as any)?.hash || '')
	const search = await fetchJson(
		`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(keyword)}${hash ? `&hash=${encodeURIComponent(hash)}` : ''}`,
		{ headers: { 'User-Agent': 'Mozilla/5.0' } },
	)
	const candidates = Array.isArray(search?.candidates) ? search.candidates : []
	if (candidates.length === 0) throw new Error('Kugou lyric unavailable')

	const durationMs = Number(musicItem.duration || 0) * 1000
	const candidate = [...candidates].sort((left, right) => {
		if (!durationMs) return Number(right?.score || 0) - Number(left?.score || 0)
		return (
			Math.abs(Number(left?.duration || 0) - durationMs) -
			Math.abs(Number(right?.duration || 0) - durationMs)
		)
	})[0]
	const download = await fetchJson(
		`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`,
		{ headers: { 'User-Agent': 'Mozilla/5.0' } },
	)
	if (!download?.content) throw new Error('Kugou lyric download unavailable')
	return { rawLrc: b64DecodeUnicode(download.content) }
}

const getWyLyric = async (musicItem: IMusic.IMusicItem): Promise<LyricSource> => {
	const id = musicItem.songmid || musicItem.id
	const body = await fetchJson(
		`https://music.163.com/api/song/lyric?os=pc&id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`,
		{ headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' } },
	)
	if (body?.code !== 200 || !body?.lrc?.lyric) throw new Error('NetEase lyric unavailable')
	return {
		rawLrc: body.lrc.lyric,
		...(body.tlyric?.lyric ? { translation: body.tlyric.lyric } : {}),
	}
}

const normalizeMiguLyricUrl = (value: unknown) => {
	if (typeof value !== 'string' || !value.trim()) return null
	if (/^https?:\/\//i.test(value)) return value.replace(/^http:/i, 'https:')
	return `https://d.musicapp.migu.cn/${value.replace(/^\/+/, '')}`
}

const getMgLyric = async (musicItem: IMusic.IMusicItem): Promise<LyricSource> => {
	const urls = [musicItem.lrcUrl, musicItem.ext?.lrcUrl, musicItem.lyricUrl]
		.map(normalizeMiguLyricUrl)
		.filter(Boolean) as string[]
	for (const url of Array.from(new Set(urls))) {
		try {
			const rawLrc = await fetchText(url, {
				headers: { Referer: 'https://music.migu.cn/', 'User-Agent': 'Mozilla/5.0' },
			})
			if (rawLrc.trim()) return { rawLrc }
		} catch {
			// Some Migu results contain multiple lyric mirrors; try the next one.
		}
	}
	throw new Error('Migu lyric unavailable')
}

const platformGetters: Record<string, (musicItem: IMusic.IMusicItem) => Promise<LyricSource>> = {
	tx: getTxLyric,
	kw: getKwLyric,
	kg: getKgLyric,
	wy: getWyLyric,
	mg: getMgLyric,
}

export const myGetLyric = async (musicItem: IMusic.IMusicItem): Promise<LyricSource> => {
	const embedded = getEmbeddedLyric(musicItem)
	if (embedded) return embedded

	const platform = normalizeMusicPlatform(
		musicItem.platform || (musicItem as IMusic.IMusicItem & { source?: string }).source,
	)
	try {
		const getter = platformGetters[platform]
		if (!getter) throw new Error(`Unsupported lyric platform: ${platform}`)
		return await getter(musicItem)
	} catch (error) {
		logError(`[lyric][${platform}] 获取歌词失败:`, error)
		return { rawLrc: DEFAULT_LYRIC }
	}
}
