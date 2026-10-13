import musicSdk from '@/components/utils/musicSdk'
import { unknownTrackImageUri } from '@/constants/images'
import { normalizeArtworkUrl } from '@/helpers/artworkResolver'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'

export type PublicPlaylistCategory = {
	id: string
	name: string
}

export type PublicPlaylist = {
	id: string
	source: MusicPlatform
	name: string
	author: string
	artwork: string
	playCount: string
	total?: number
	description?: string
}

export type PublicPlaylistPage = {
	list: PublicPlaylist[]
	page: number
	hasMore: boolean
}

const headers = {
	'User-Agent': 'Mozilla/5.0',
	Referer: 'https://music.163.com/',
}

const toArtwork = (value: unknown) =>
	typeof value === 'string' && value.trim()
		? normalizeArtworkUrl(value.replace('{size}', '500'))
		: unknownTrackImageUri

const formatPlayCount = (value: unknown) => {
	if (typeof value === 'string' && /[万亿]/.test(value)) return value
	const count = Number(value)
	if (!Number.isFinite(count) || count <= 0) return ''
	if (count >= 100_000_000)
		return `${(count / 100_000_000).toFixed(count >= 1_000_000_000 ? 0 : 1)}亿`
	if (count >= 10_000) return `${(count / 10_000).toFixed(count >= 100_000 ? 0 : 1)}万`
	return String(Math.round(count))
}

const fetchText = async (url: string, requestHeaders: Record<string, string> = headers) => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 15_000)
	try {
		const response = await fetch(url, { headers: requestHeaders, signal: controller.signal })
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return response.text()
	} finally {
		clearTimeout(timer)
	}
}

const fetchJson = async (url: string, requestHeaders?: Record<string, string>) =>
	JSON.parse(await fetchText(url, requestHeaders))

const uniqueCategories = (categories: PublicPlaylistCategory[]) => {
	const seen = new Set<string>()
	return categories.filter((item) => {
		if (!item.name || seen.has(item.id)) return false
		seen.add(item.id)
		return true
	})
}

const categoryFallbacks: Record<MusicPlatform, PublicPlaylistCategory[]> = {
	tx: [
		{ id: '', name: '推荐' },
		{ id: '165', name: '流行' },
		{ id: '167', name: '摇滚' },
		{ id: '168', name: '民谣' },
		{ id: '194', name: '轻音乐' },
	],
	wy: [
		{ id: '', name: '推荐' },
		{ id: '华语', name: '华语' },
		{ id: '流行', name: '流行' },
		{ id: '摇滚', name: '摇滚' },
		{ id: '民谣', name: '民谣' },
		{ id: '电子', name: '电子' },
		{ id: '轻音乐', name: '轻音乐' },
	],
	kg: [{ id: '', name: '推荐' }],
	kw: [
		{ id: '', name: '推荐' },
		{ id: '1265-10000', name: '经典' },
		{ id: '2200-10000', name: '情歌' },
	],
	mg: [{ id: '', name: '推荐' }],
}

const loadTxCategories = async (): Promise<PublicPlaylistCategory[]> => {
	const result = await musicSdk.tx.songList.getTags()
	return [
		{ id: '', name: '推荐' },
		...(result.hotTag ?? []).map((item: { id: string | number; name: string }) => ({
			id: String(item.id),
			name: item.name,
		})),
	]
}

const loadKwCategories = async (): Promise<PublicPlaylistCategory[]> => {
	const body = await fetchJson(
		'https://wapi.kuwo.cn/api/pc/classify/playlist/getRcmTagList?loginUid=0&loginSid=0&appUid=76039576',
	)
	const items = body?.data?.[0]?.data ?? []
	return [
		{ id: '', name: '推荐' },
		...items.map((item: any) => ({ id: `${item.id}-${item.digest}`, name: item.name })),
	]
}

const loadMgCategories = async (): Promise<PublicPlaylistCategory[]> => {
	const body = await fetchJson(
		'https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release',
		{ ...headers, Referer: 'https://m.music.migu.cn/' },
	)
	const groups = body?.data ?? []
	const items = groups.flatMap((group: any) => group.content ?? [])
	return [
		{ id: '', name: '推荐' },
		...items.map((item: any) => ({
			id: String(item.texts?.[1] ?? ''),
			name: String(item.texts?.[0] ?? ''),
		})),
	]
}

export const getPublicPlaylistCategories = async (
	source: MusicPlatform,
): Promise<PublicPlaylistCategory[]> => {
	try {
		const categories =
			source === 'tx'
				? await loadTxCategories()
				: source === 'kw'
					? await loadKwCategories()
					: source === 'mg'
						? await loadMgCategories()
						: categoryFallbacks[source]
		return uniqueCategories(categories).slice(0, 12)
	} catch {
		return categoryFallbacks[source]
	}
}

const mapPlaylist = (source: MusicPlatform, item: any): PublicPlaylist => ({
	id: String(item.id ?? item.tid ?? item.specialid ?? item.resId ?? item.logEvent?.contentId),
	source,
	name: String(item.name ?? item.title ?? item.specialname ?? item.txt ?? '未命名歌单'),
	author: String(item.author ?? item.username ?? item.creator?.nickname ?? item.uname ?? ''),
	artwork: toArtwork(
		item.artwork ??
			item.img ??
			item.imageUrl ??
			item.imgurl ??
			item.coverImgUrl ??
			item.cover_url_medium,
	),
	playCount: formatPlayCount(
		item.playCount ?? item.play_count ?? item.playcount ?? item.access_num ?? item.listencnt,
	),
	total: Number(item.total ?? item.trackCount ?? item.songcount) || undefined,
	description: String(item.description ?? item.desc ?? item.intro ?? item.txt2 ?? ''),
})

const loadTxPlaylists = async (categoryId: string, page: number): Promise<PublicPlaylistPage> => {
	const result = await musicSdk.tx.songList.getList('5', categoryId || null, page)
	return {
		list: (result.list ?? []).map((item: any) => mapPlaylist('tx', item)),
		page,
		hasMore: page * Number(result.limit || 36) < Number(result.total || 0),
	}
}

const loadWyPlaylists = async (categoryId: string, page: number): Promise<PublicPlaylistPage> => {
	const limit = 30
	const query = new URLSearchParams({
		cat: categoryId || '全部',
		order: 'hot',
		offset: String((page - 1) * limit),
		limit: String(limit),
		total: 'true',
	})
	const body = await fetchJson(`https://music.163.com/api/playlist/list?${query}`, headers)
	return {
		list: (body.playlists ?? []).map((item: any) => mapPlaylist('wy', item)),
		page,
		hasMore: body.more === true || page * limit < Number(body.total || 0),
	}
}

const loadKwPlaylists = async (categoryId: string, page: number): Promise<PublicPlaylistPage> => {
	const limit = 30
	const [id, type] = categoryId.split('-')
	const url = categoryId
		? `https://wapi.kuwo.cn/api/pc/classify/playlist/getTagPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&id=${id}&rn=${limit}`
		: `https://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&rn=${limit}&order=hot`
	if (categoryId && type !== '10000') return loadKwPlaylists('', page)
	const body = await fetchJson(url)
	const data = body?.data ?? {}
	return {
		list: (data.data ?? []).map((item: any) => mapPlaylist('kw', item)),
		page,
		hasMore: page * Number(data.rn || limit) < Number(data.total || 0),
	}
}

const loadKgPlaylists = async (page: number): Promise<PublicPlaylistPage> => {
	const body = JSON.parse(await fetchText(`https://m.kugou.com/plist/index?json=true&page=${page}`))
	const data = body?.plist?.list ?? {}
	return {
		list: (data.info ?? []).map((item: any) => mapPlaylist('kg', item)),
		page,
		hasMore: page * (data.info?.length || 0) < Number(data.total || 0),
	}
}

const collectMgPlaylists = (nodes: any[], result: any[] = [], ids = new Set<string>()) => {
	for (const item of nodes) {
		if (Array.isArray(item?.contents)) collectMgPlaylists(item.contents, result, ids)
		const id = String(item?.resId ?? item?.logEvent?.contentId ?? '')
		if (item?.resType === '2021' && id && !ids.has(id)) {
			ids.add(id)
			result.push(item)
		}
	}
	return result
}

const loadMgPlaylists = async (categoryId: string, page: number): Promise<PublicPlaylistPage> => {
	const url = categoryId
		? `https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?pageNumber=${page}&templateVersion=2&tagId=${categoryId}`
		: `https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`
	const body = await fetchJson(url, { ...headers, Referer: 'https://m.music.migu.cn/' })
	const list = body?.data?.contents
		? collectMgPlaylists(body.data.contents)
		: body?.data?.contentItemList?.[1]?.itemList ?? []
	return { list: list.map((item: any) => mapPlaylist('mg', item)), page, hasMore: list.length > 0 }
}

export const getPublicPlaylists = async (
	source: MusicPlatform,
	categoryId = '',
	page = 1,
): Promise<PublicPlaylistPage> => {
	const result =
		source === 'tx'
			? await loadTxPlaylists(categoryId, page)
			: source === 'wy'
				? await loadWyPlaylists(categoryId, page)
				: source === 'kw'
					? await loadKwPlaylists(categoryId, page)
					: source === 'kg'
						? await loadKgPlaylists(page)
						: await loadMgPlaylists(categoryId, page)
	const seen = new Set<string>()
	return {
		...result,
		list: result.list.filter((item) => {
			if (!item.id || seen.has(item.id)) return false
			seen.add(item.id)
			return true
		}),
	}
}
