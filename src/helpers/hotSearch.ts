import musicSdk from '@/components/utils/musicSdk'
import {
	MUSIC_PLATFORMS,
	type MusicPlatform,
	type SearchPlatform,
} from '@/helpers/crossPlatformSearch'

const hotSearchCache = new Map<SearchPlatform, string[]>()

const normalizeKeywords = (keywords: unknown[]) => {
	const unique = new Set<string>()
	for (const keyword of keywords) {
		if (typeof keyword !== 'string') continue
		const normalized = keyword.trim()
		if (normalized) unique.add(normalized)
	}
	return Array.from(unique)
}

const mergePlatformKeywords = (lists: string[][]) => {
	const merged: string[] = []
	const longest = Math.max(0, ...lists.map((list) => list.length))
	for (let index = 0; index < longest; index++) {
		for (const list of lists) {
			if (list[index]) merged.push(list[index])
		}
	}
	return normalizeKeywords(merged)
}

const loadPlatformHotSearches = async (platform: MusicPlatform, forceRefresh: boolean) => {
	if (!forceRefresh) {
		const cached = hotSearchCache.get(platform)
		if (cached?.length) return cached
	}

	const provider = musicSdk[platform]?.hotSearch
	if (!provider) throw new Error(`Trending searches are not available for ${platform}`)
	const result = await provider.getList()
	const keywords = normalizeKeywords(Array.isArray(result?.list) ? result.list : [])
	if (!keywords.length) throw new Error(`No trending searches returned for ${platform}`)
	hotSearchCache.set(platform, keywords)
	return keywords
}

export const getHotSearches = async (
	platform: SearchPlatform,
	forceRefresh = false,
): Promise<string[]> => {
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

	const keywords = mergePlatformKeywords(availableLists)
	hotSearchCache.set('all', keywords)
	return keywords
}
