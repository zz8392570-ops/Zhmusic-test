import SearchDiscovery from '@/components/search/SearchDiscovery'
import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import SearchSuggestions from '@/components/search/SearchSuggestions'
import { SearchList } from '@/components/SearchList'
import musicSdk from '@/components/utils/musicSdk'
import { ThemeColors } from '@/constants/tokens'
import { addSearchHistory, removeSearchHistory } from '@/helpers/searchHistory'
import searchAll, { type SearchType } from '@/helpers/searchAll'
import { getHotSearches } from '@/helpers/hotSearch'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import {
	deduplicateCrossPlatformTracks,
	type MusicPlatform,
	type SearchPlatform,
} from '@/helpers/crossPlatformSearch'
import { useThemeColors } from '@/hooks/useAppTheme'
import { cacheRevisionStore } from '@/helpers/trackPlayerIndex'
import { getCachedQuality } from '@/player/CacheManager'
import { useNavigationSearchController } from '@/hooks/useNavigationSearch'
import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const SEARCH_TABS: { type: SearchType; label: string }[] = [
	{ type: 'songs', label: 'find.songs' },
	{ type: 'artists', label: 'find.artists' },
	{ type: 'playlists', label: 'find.playlists' },
]
type SongFilter = 'all' | 'lossless' | 'cached' | 'multiSource'
const SONG_FILTERS: { type: SongFilter; label: string }[] = [
	{ type: 'all', label: 'find.filters.all' },
	{ type: 'lossless', label: 'find.filters.lossless' },
	{ type: 'cached', label: 'find.filters.cached' },
	{ type: 'multiSource', label: 'find.filters.multiSource' },
]
const HOT_SEARCH_BATCH_SIZE = 10

const trackKey = (track: Track) => `${track.platform ?? 'unknown'}:${track.id}`

const SearchScreen = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const searchType = PersistStatus.useValue('search.type', 'songs') ?? 'songs'
	const searchPlatform = PersistStatus.useValue('search.platform', 'all') ?? 'all'
	const searchHistory = PersistStatus.useValue('search.history', []) ?? []
	const [searchResults, setSearchResults] = useState<Track[]>([])
	const [submittedQuery, setSubmittedQuery] = useState('')
	const [searchRevision, setSearchRevision] = useState(0)
	const [suggestions, setSuggestions] = useState<string[]>([])
	const [hotSearches, setHotSearches] = useState<string[]>([])
	const [hotSearchBatch, setHotSearchBatch] = useState(0)
	const [page, setPage] = useState(1)
	const [isLoading, setIsLoading] = useState(false)
	const [isSuggestionLoading, setIsSuggestionLoading] = useState(false)
	const [isHotLoading, setIsHotLoading] = useState(true)
	const [hasMore, setHasMore] = useState(false)
	const [hasSearchError, setHasSearchError] = useState(false)
	const [hasHotError, setHasHotError] = useState(false)
	const [unavailablePlatforms, setUnavailablePlatforms] = useState<MusicPlatform[]>([])
	const [pendingPlatforms, setPendingPlatforms] = useState<MusicPlatform[]>([])
	const resultsRef = useRef<Track[]>([])
	const unavailableRef = useRef<MusicPlatform[]>([])
	const [isEditing, setIsEditing] = useState(false)
	const [songFilter, setSongFilter] = useState<SongFilter>('all')
	const [cachedResultKeys, setCachedResultKeys] = useState<Set<string>>(new Set())
	const cacheRevision = cacheRevisionStore.useValue()
	const searchRequestRef = useRef(0)
	const suggestionRequestRef = useRef(0)
	const hotSearchRequestRef = useRef(0)
	const cancelSearchRequest = useCallback(() => {
		searchRequestRef.current++
	}, [])
	const cancelSuggestionRequest = useCallback(() => {
		suggestionRequestRef.current++
	}, [])
	const cancelHotSearchRequest = useCallback(() => {
		hotSearchRequestRef.current++
	}, [])

	const resetResults = useCallback(() => {
		cancelSearchRequest()
		setSubmittedQuery('')
		setSearchResults([])
		resultsRef.current = []
		unavailableRef.current = []
		setPendingPlatforms([])
		setPage(1)
		setHasMore(false)
		setHasSearchError(false)
		setUnavailablePlatforms([])
		setIsLoading(false)
	}, [cancelSearchRequest])

	const submitSearch = useCallback(
		(value: string) => {
			const keyword = value.trim()
			if (!keyword) {
				resetResults()
				return
			}

			const history = PersistStatus.get('search.history') ?? []
			cancelSearchRequest()
			PersistStatus.set('search.history', addSearchHistory(history, keyword))
			setSubmittedQuery(keyword)
			setSearchRevision((revision) => revision + 1)
			setSuggestions([])
			setHasSearchError(false)
			setIsLoading(true)
			setIsEditing(false)
		},
		[cancelSearchRequest, resetResults],
	)

	const handleCancelSearch = useCallback(() => {
		cancelSuggestionRequest()
		setSuggestions([])
		setIsSuggestionLoading(false)
		setIsEditing(false)
		resetResults()
	}, [cancelSuggestionRequest, resetResults])

	const searchBarOptions = useMemo(
		() => ({
			placeholder: i18n.t('find.inSearch'),
			cancelButtonText: i18n.t('find.cancel'),
			autoCapitalize: 'none' as const,
			obscureBackground: false,
		}),
		[],
	)
	const handleFocusSearch = useCallback(() => setIsEditing(true), [])
	const {
		search: draftQuery,
		setSearchText,
		blur: blurSearch,
	} = useNavigationSearchController({
		searchBarOptions,
		debounceMs: 0,
		onFocus: handleFocusSearch,
		onCancel: handleCancelSearch,
		onSubmit: submitSearch,
	})

	const hotSearchPlatform: SearchPlatform = searchType === 'songs' ? searchPlatform : 'tx'

	const loadHotSearches = useCallback(async (platform: SearchPlatform, forceRefresh = false) => {
		const requestId = ++hotSearchRequestRef.current
		setIsHotLoading(true)
		setHasHotError(false)
		setHotSearches([])
		setHotSearchBatch(0)

		try {
			const result = await getHotSearches(platform, forceRefresh)
			if (requestId !== hotSearchRequestRef.current) return
			setHotSearches(result)
		} catch (error) {
			if (requestId !== hotSearchRequestRef.current) return
			console.error('Failed to fetch hot searches:', error)
			setHasHotError(true)
		} finally {
			if (requestId === hotSearchRequestRef.current) {
				setIsHotLoading(false)
			}
		}
	}, [])

	useEffect(() => {
		void loadHotSearches(hotSearchPlatform)
		return cancelHotSearchRequest
	}, [cancelHotSearchRequest, hotSearchPlatform, loadHotSearches])

	useEffect(() => {
		const keyword = draftQuery.trim()
		if (!isEditing || !keyword) {
			cancelSuggestionRequest()
			setSuggestions([])
			setIsSuggestionLoading(false)
			return
		}

		const requestId = ++suggestionRequestRef.current
		setIsSuggestionLoading(true)
		const timer = setTimeout(() => {
			musicSdk['tx'].tipSearch
				.search(keyword)
				.then((result) => {
					if (requestId === suggestionRequestRef.current) {
						setSuggestions(result.filter(Boolean))
					}
				})
				.catch(() => {
					if (requestId === suggestionRequestRef.current) {
						setSuggestions([])
					}
				})
				.finally(() => {
					if (requestId === suggestionRequestRef.current) {
						setIsSuggestionLoading(false)
					}
				})
		}, 220)

		return () => {
			clearTimeout(timer)
			cancelSuggestionRequest()
			musicSdk['tx'].tipSearch.cancelTipSearch()
		}
	}, [cancelSuggestionRequest, draftQuery, isEditing])

	const fetchSearchResults = useCallback(
		async (query: string, type: SearchType, platform: SearchPlatform, currentPage: number) => {
			const requestId = ++searchRequestRef.current
			setIsLoading(true)
			setHasSearchError(false)
			const previousResults = currentPage === 1 ? [] : resultsRef.current
			const previousUnavailable = currentPage === 1 ? [] : unavailableRef.current
			const applyResults = (result: {
				data: Track[]
				hasMore: boolean
				unavailablePlatforms: MusicPlatform[]
				pendingPlatforms?: MusicPlatform[]
			}) => {
				if (requestId !== searchRequestRef.current) return
				const next = [...previousResults, ...result.data]
				resultsRef.current =
					type === 'songs' && platform === 'all' ? deduplicateCrossPlatformTracks(next) : next
				setSearchResults(resultsRef.current)
				setHasMore(result.hasMore)
				setPendingPlatforms(result.pendingPlatforms ?? [])
				unavailableRef.current = Array.from(
					new Set([...previousUnavailable, ...result.unavailablePlatforms]),
				)
				setUnavailablePlatforms(unavailableRef.current)
			}

			try {
				const {
					data,
					hasMore: moreResults,
					unavailablePlatforms: failedPlatforms,
				} = await searchAll(query, currentPage, type, platform, applyResults)
				if (requestId !== searchRequestRef.current) return

				applyResults({ data, hasMore: moreResults, unavailablePlatforms: failedPlatforms })
				setPage(currentPage)
			} catch (error) {
				if (requestId !== searchRequestRef.current) return
				console.error('Error fetching search results:', error)
				setHasSearchError(true)
			} finally {
				if (requestId === searchRequestRef.current) {
					setIsLoading(false)
					setPendingPlatforms([])
				}
			}
		},
		[],
	)

	useEffect(() => {
		cancelSearchRequest()
		setSearchResults([])
		resultsRef.current = []
		unavailableRef.current = []
		setPendingPlatforms([])
		setPage(1)
		setHasMore(false)
		setHasSearchError(false)
		setUnavailablePlatforms([])

		if (submittedQuery) {
			void fetchSearchResults(submittedQuery, searchType, searchPlatform, 1)
		}

		return cancelSearchRequest
	}, [
		cancelSearchRequest,
		fetchSearchResults,
		searchPlatform,
		searchRevision,
		searchType,
		submittedQuery,
	])

	const handleKeywordSearch = useCallback(
		(keyword: string) => {
			setSearchText(keyword)
			submitSearch(keyword)
			blurSearch()
		},
		[blurSearch, setSearchText, submitSearch],
	)

	const handleSearchTypeChange = useCallback((type: SearchType) => {
		PersistStatus.set('search.type', type)
	}, [])
	const handleSearchPlatformChange = useCallback((platform: SearchPlatform) => {
		PersistStatus.set('search.platform', platform)
	}, [])

	const handleLoadMore = useCallback(() => {
		if (!isLoading && !hasSearchError && hasMore && submittedQuery) {
			void fetchSearchResults(submittedQuery, searchType, searchPlatform, page + 1)
		}
	}, [
		fetchSearchResults,
		hasMore,
		hasSearchError,
		isLoading,
		page,
		searchPlatform,
		searchType,
		submittedQuery,
	])

	const handleRetrySearch = useCallback(() => {
		if (!submittedQuery || isLoading) return
		const retryPage = searchResults.length > 0 ? page + 1 : 1
		void fetchSearchResults(submittedQuery, searchType, searchPlatform, retryPage)
	}, [
		fetchSearchResults,
		isLoading,
		page,
		searchPlatform,
		searchResults.length,
		searchType,
		submittedQuery,
	])

	const handleRemoveHistory = useCallback((keyword: string) => {
		const history = PersistStatus.get('search.history') ?? []
		PersistStatus.set('search.history', removeSearchHistory(history, keyword))
	}, [])

	const trimmedDraftQuery = draftQuery.trim()
	const showSuggestions = isEditing && trimmedDraftQuery.length > 0
	const showDiscovery = isEditing ? trimmedDraftQuery.length === 0 : submittedQuery.length === 0
	const showResults = !isEditing && submittedQuery.length > 0
	const hotSearchBatchCount = Math.ceil(hotSearches.length / HOT_SEARCH_BATCH_SIZE)
	const visibleHotSearches = useMemo(() => {
		const start = hotSearchBatch * HOT_SEARCH_BATCH_SIZE
		return hotSearches.slice(start, start + HOT_SEARCH_BATCH_SIZE)
	}, [hotSearchBatch, hotSearches])
	const hotSearchTitle = i18n.t('find.platformHotSearch', {
		platform: i18n.t(
			hotSearchPlatform === 'all'
				? 'find.platformAll'
				: getMusicPlatformLabelKey(hotSearchPlatform),
		),
	})
	const handleChangeHotSearch = useCallback(() => {
		setHotSearchBatch((currentBatch) =>
			hotSearchBatchCount > 1 ? (currentBatch + 1) % hotSearchBatchCount : 0,
		)
	}, [hotSearchBatchCount])

	useEffect(() => {
		let cancelled = false
		if (searchType !== 'songs' || !searchResults.length) {
			setCachedResultKeys(new Set())
			return
		}
		void Promise.all(
			searchResults.map(async (track) => {
				const candidates = [track, ...(track.sourceAlternatives ?? [])]
				const qualities = await Promise.all(
					candidates.map((candidate) => getCachedQuality(candidate as IMusic.IMusicItem)),
				)
				return qualities.some(Boolean) ? trackKey(track) : null
			}),
		).then((keys) => {
			if (!cancelled) setCachedResultKeys(new Set(keys.filter((key): key is string => !!key)))
		})
		return () => {
			cancelled = true
		}
	}, [cacheRevision, searchResults, searchType])

	const visibleSearchResults = useMemo(() => {
		if (searchType !== 'songs' || songFilter === 'all') return searchResults
		return searchResults.filter((track) => {
			if (songFilter === 'cached') return cachedResultKeys.has(trackKey(track))
			if (songFilter === 'multiSource') {
				return new Set(track.availablePlatforms ?? [track.platform]).size > 1
			}
			const quality = track.qualities as Record<string, unknown> | undefined
			return Boolean(quality?.flac || quality?.flac24bit || track.source?.flac)
		})
	}, [cachedResultKeys, searchResults, searchType, songFilter])

	return (
		<SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
			<View style={styles.contentContainer}>
				<View style={styles.segmentedControl}>
					{SEARCH_TABS.map((tab) => {
						const isSelected = searchType === tab.type
						return (
							<Pressable
								key={tab.type}
								accessibilityRole="tab"
								accessibilityState={{ selected: isSelected }}
								onPress={() => handleSearchTypeChange(tab.type)}
								style={({ pressed }) => [
									styles.segment,
									isSelected && styles.activeSegment,
									pressed && styles.pressed,
								]}
							>
								<Text style={[styles.segmentText, isSelected && styles.activeSegmentText]}>
									{i18n.t(tab.label)}
								</Text>
							</Pressable>
						)
					})}
				</View>
				{searchType === 'songs' ? (
					<SearchPlatformSelector value={searchPlatform} onChange={handleSearchPlatformChange} />
				) : (
					<View style={styles.providerNotice}>
						<Text style={styles.providerNoticeText}>{i18n.t('find.qqOnlyNotice')}</Text>
					</View>
				)}
				{showResults && searchType === 'songs' ? (
					<View style={styles.filterRow}>
						{SONG_FILTERS.map((filter) => (
							<Pressable
								key={filter.type}
								accessibilityRole="button"
								accessibilityState={{ selected: songFilter === filter.type }}
								onPress={() => setSongFilter(filter.type)}
								style={[styles.filterChip, songFilter === filter.type && styles.filterChipActive]}
							>
								<Text
									style={[styles.filterText, songFilter === filter.type && styles.filterTextActive]}
								>
									{i18n.t(filter.label)}
								</Text>
							</Pressable>
						))}
					</View>
				) : null}

				{showSuggestions ? (
					<SearchSuggestions
						query={trimmedDraftQuery}
						suggestions={suggestions}
						isLoading={isSuggestionLoading}
						onSearch={handleKeywordSearch}
					/>
				) : null}
				{showDiscovery ? (
					<SearchDiscovery
						history={searchHistory}
						hotSearches={visibleHotSearches}
						hotSearchTitle={hotSearchTitle}
						hotRankOffset={hotSearchBatch * HOT_SEARCH_BATCH_SIZE}
						canChangeHotSearch={hotSearchBatchCount > 1}
						isHotLoading={isHotLoading}
						hasHotError={hasHotError}
						onSearch={handleKeywordSearch}
						onRemoveHistory={handleRemoveHistory}
						onClearHistory={() => PersistStatus.set('search.history', [])}
						onRetryHotSearch={() => void loadHotSearches(hotSearchPlatform, true)}
						onChangeHotSearch={handleChangeHotSearch}
					/>
				) : null}
				{showResults ? (
					<SearchList
						tracks={visibleSearchResults}
						query={submittedQuery}
						onLoadMore={handleLoadMore}
						onRetry={handleRetrySearch}
						hasMore={hasMore}
						hasError={hasSearchError}
						isLoading={isLoading}
						unavailablePlatforms={unavailablePlatforms}
						pendingPlatforms={pendingPlatforms}
					/>
				) : null}
			</View>
		</SafeAreaView>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		safeArea: {
			flex: 1,
			backgroundColor: colors.background,
		},
		contentContainer: {
			flex: 1,
			backgroundColor: colors.background,
			paddingTop: 8,
		},
		segmentedControl: {
			height: 36,
			flexDirection: 'row',
			marginHorizontal: 16,
			marginBottom: 6,
			padding: 2,
			borderRadius: 10,
			backgroundColor: colors.surfaceMuted,
		},
		segment: {
			flex: 1,
			alignItems: 'center',
			justifyContent: 'center',
			borderRadius: 8,
		},
		activeSegment: {
			backgroundColor: colors.surfaceElevated,
			shadowColor: colors.shadow,
			shadowOffset: { width: 0, height: 1 },
			shadowOpacity: 0.12,
			shadowRadius: 2,
			elevation: 2,
		},
		segmentText: {
			color: colors.textMuted,
			fontSize: 14,
			fontWeight: '500',
		},
		activeSegmentText: {
			color: colors.primary,
			fontWeight: '600',
		},
		pressed: {
			opacity: 0.6,
		},
		providerNotice: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 9,
			marginBottom: 6,
			marginHorizontal: 16,
			paddingHorizontal: 12,
			paddingVertical: 8,
		},
		providerNoticeText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
		filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
		filterChip: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 14,
			paddingHorizontal: 11,
			paddingVertical: 6,
		},
		filterChipActive: { backgroundColor: colors.primary },
		filterText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
		filterTextActive: { color: '#fff' },
	})

export default SearchScreen
