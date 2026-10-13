import musicSdk from '@/components/utils/musicSdk'
import {
	MUSIC_PLATFORMS,
	type MusicPlatform,
	type SearchPlatform,
} from '@/helpers/crossPlatformSearch'

export type HotSearchItem = {
	keyword: string
	platform: MusicPlatform
	score?: number
	badgeUrl?: string
	badgeText?: string
}
export const HOT_SEARCH_TTL_MS = 5 * 60_000
type HotSearchCacheEntry = { items: HotSearchItem[]; updatedAt: number }
export type HotSearchSnapshot = {
	items: HotSearchItem[]
	stalePlatforms: MusicPlatform[]
}
const hotSearchCache = new Map<MusicPlatform, HotSearchCacheEntry>()
const pendingHotSearches = new Map<MusicPlatform, Promise<HotSearchCacheEntry>>()

export const normalizeHotSearchItems = (
	items: unknown[],
	platform: MusicPlatform,
): HotSearchItem[] => {
	const seen = new Set<string>()
	return items.flatMap((raw) => {
		const value =
			typeof raw === 'string'
				? { keyword: raw }
				: (raw as {
						keyword?: unknown
						score?: unknown
						badgeUrl?: unknown
						badgeText?: unknown
					} | null)
		if (!value || typeof value.keyword !== 'string') return []
		const keyword = value.keyword.trim()
		if (!keyword || seen.has(keyword)) return []
		seen.add(keyword)
		const score = Number(value.score)
		const item: HotSearchItem = {
			keyword,
			platform,
			score: Number.isFinite(score) && score > 0 ? score : undefined,
		}
		if (typeof value.badgeUrl === 'string' && /^https?:\/\//i.test(value.badgeUrl))
			item.badgeUrl = value.badgeUrl.replace(/^http:/i, 'https:')
		if (typeof value.badgeText === 'string' && value.badgeText.trim())
			item.badgeText = value.badgeText.trim()
		return [item]
	})
}

export const mergeHotSearchItems = (lists: HotSearchItem[][]): HotSearchItem[] => {
	const merged = new Map<string, HotSearchItem>()
	const longest = Math.max(0, ...lists.map((list) => list.length))
	for (let index = 0; index < longest; index++) {
		for (const list of lists) {
			const item = list[index]
			if (!item) continue
			const previous = merged.get(item.keyword)
			if (!previous || (!previous.score && item.score)) merged.set(item.keyword, item)
		}
	}
	return Array.from(merged.values())
}

export const formatHotSearchScore = (score?: number): string => {
	if (!score || !Number.isFinite(score) || score <= 0) return ''
	if (score >= 100_000_000) return `${(score / 100_000_000).toFixed(1)}亿`
	if (score >= 10_000) return `${(score / 10_000).toFixed(1)}万`
	return String(Math.round(score))
}

const loadPlatformHotSearches = (
	platform: MusicPlatform,
	forceRefresh: boolean,
): Promise<HotSearchCacheEntry> => {
	// A manual refresh and an all-platform refresh share the same provider request.
	const pending = pendingHotSearches.get(platform)
	if (pending) return pending
	const cached = hotSearchCache.get(platform)
	if (!forceRefresh && cached && Date.now() - cached.updatedAt < HOT_SEARCH_TTL_MS)
		return Promise.resolve(cached)
	const request = (async () => {
		const provider = musicSdk[platform]?.hotSearch
		if (!provider) throw new Error(`Trending searches are not available for ${platform}`)
		const result = await provider.getList()
		const items = normalizeHotSearchItems(
			Array.isArray(result?.items) ? result.items : result?.list ?? [],
			platform,
		)
		if (!items.length) throw new Error(`No trending searches returned for ${platform}`)
		const entry = { items, updatedAt: Date.now() }
		hotSearchCache.set(platform, entry)
		return entry
	})()
	pendingHotSearches.set(platform, request)
	void request
		.finally(() => {
			if (pendingHotSearches.get(platform) === request) pendingHotSearches.delete(platform)
		})
		.catch(() => {})
	return request
}

export const getHotSearchSnapshot = async (
	platform: SearchPlatform,
	forceRefresh = false,
): Promise<HotSearchSnapshot> => {
	const sources = platform === 'all' ? MUSIC_PLATFORMS : [platform]
	const results = await Promise.allSettled(
		sources.map((source) => loadPlatformHotSearches(source, forceRefresh)),
	)
	const stalePlatforms: MusicPlatform[] = []
	const availableLists = results.flatMap((result, index) => {
		const source = sources[index]
		if (result.status === 'fulfilled')
			return [hotSearchCache.get(source)?.items ?? result.value.items]
		stalePlatforms.push(source)
		const cached = hotSearchCache.get(source)
		return cached ? [cached.items] : []
	})
	if (!availableLists.length) throw new Error('All trending search providers failed')
	// Build aggregates from current provider entries, never an independently stale all cache.
	return { items: mergeHotSearchItems(availableLists), stalePlatforms }
}

export const getHotSearchItems = async (
	platform: SearchPlatform,
	forceRefresh = false,
): Promise<HotSearchItem[]> => (await getHotSearchSnapshot(platform, forceRefresh)).items

export const getHotSearches = async (
	platform: SearchPlatform,
	forceRefresh = false,
): Promise<string[]> =>
	(await getHotSearchItems(platform, forceRefresh)).map((item) => item.keyword)
