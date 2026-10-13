import musicSdk from '@/components/utils/musicSdk'
import {
	MUSIC_PLATFORMS,
	type MusicPlatform,
	type SearchPlatform,
} from '@/helpers/crossPlatformSearch'

export type HotSearchItem = { keyword: string; platform: MusicPlatform; score?: number }
const hotSearchCache = new Map<SearchPlatform, HotSearchItem[]>()

export const normalizeHotSearchItems = (
	items: unknown[],
	platform: MusicPlatform,
): HotSearchItem[] => {
	const seen = new Set<string>()
	return items.flatMap((raw) => {
		const value =
			typeof raw === 'string'
				? { keyword: raw }
				: (raw as { keyword?: unknown; score?: unknown } | null)
		if (!value || typeof value.keyword !== 'string') return []
		const keyword = value.keyword.trim()
		if (!keyword || seen.has(keyword)) return []
		seen.add(keyword)
		const score = Number(value.score)
		return [{ keyword, platform, score: Number.isFinite(score) && score > 0 ? score : undefined }]
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

const loadPlatformHotSearches = async (platform: MusicPlatform, forceRefresh: boolean) => {
	if (!forceRefresh) {
		const cached = hotSearchCache.get(platform)
		if (cached?.length) return cached
	}
	const provider = musicSdk[platform]?.hotSearch
	if (!provider) throw new Error(`Trending searches are not available for ${platform}`)
	const result = await provider.getList()
	const items = normalizeHotSearchItems(
		Array.isArray(result?.items) ? result.items : result?.list ?? [],
		platform,
	)
	if (!items.length) throw new Error(`No trending searches returned for ${platform}`)
	hotSearchCache.set(platform, items)
	return items
}

export const getHotSearchItems = async (
	platform: SearchPlatform,
	forceRefresh = false,
): Promise<HotSearchItem[]> => {
	if (!forceRefresh) {
		const cached = hotSearchCache.get(platform)
		if (cached?.length) return cached
	}
	if (platform !== 'all') return loadPlatformHotSearches(platform, forceRefresh)
	const results = await Promise.allSettled(
		MUSIC_PLATFORMS.map((source) => loadPlatformHotSearches(source, forceRefresh)),
	)
	const availableLists = results.flatMap((result) =>
		result.status === 'fulfilled' ? [result.value] : [],
	)
	if (!availableLists.length) throw new Error('All trending search providers failed')
	const items = mergeHotSearchItems(availableLists)
	hotSearchCache.set('all', items)
	return items
}

export const getHotSearches = async (
	platform: SearchPlatform,
	forceRefresh = false,
): Promise<string[]> =>
	(await getHotSearchItems(platform, forceRefresh)).map((item) => item.keyword)
