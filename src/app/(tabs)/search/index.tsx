import SearchDiscovery from '@/components/search/SearchDiscovery'
import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import SearchSuggestions from '@/components/search/SearchSuggestions'
import { SearchList } from '@/components/SearchList'
import musicSdk from '@/components/utils/musicSdk'
import { ThemeColors } from '@/constants/tokens'
import { addSearchHistory, removeSearchHistory } from '@/helpers/searchHistory'
import searchAll, { type SearchType } from '@/helpers/searchAll'
import {
	deduplicateCrossPlatformTracks,
	type MusicPlatform,
	type SearchPlatform,
} from '@/helpers/crossPlatformSearch'
import { useThemeColors } from '@/hooks/useAppTheme'
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
	const [page, setPage] = useState(1)
	const [isLoading, setIsLoading] = useState(false)
	const [isSuggestionLoading, setIsSuggestionLoading] = useState(false)
	const [isHotLoading, setIsHotLoading] = useState(true)
	const [hasMore, setHasMore] = useState(false)
	const [hasSearchError, setHasSearchError] = useState(false)
	const [hasHotError, setHasHotError] = useState(false)
	const [unavailablePlatforms, setUnavailablePlatforms] = useState<MusicPlatform[]>([])
	const [isEditing, setIsEditing] = useState(false)
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
			PersistStatus.set('search.history', addSearchHistory(history, keyword))
			setSubmittedQuery(keyword)
			setSearchRevision((revision) => revision + 1)
			setSuggestions([])
			setHasSearchError(false)
			setIsLoading(true)
			setIsEditing(false)
		},
		[resetResults],
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

	const loadHotSearches = useCallback(async () => {
		const requestId = ++hotSearchRequestRef.current
		setIsHotLoading(true)
		setHasHotError(false)

		try {
			const result = await musicSdk['tx'].hotSearch.getList()
			if (requestId !== hotSearchRequestRef.current) return
			setHotSearches(result.list.filter(Boolean))
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
		void loadHotSearches()
		return cancelHotSearchRequest
	}, [cancelHotSearchRequest, loadHotSearches])

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

			try {
				const {
					data,
					hasMore: moreResults,
					unavailablePlatforms: failedPlatforms,
				} = await searchAll(query, currentPage, type, platform)
				if (requestId !== searchRequestRef.current) return

				setSearchResults((currentResults) => {
					const nextResults = currentPage === 1 ? data : [...currentResults, ...data]
					return type === 'songs' && platform === 'all'
						? deduplicateCrossPlatformTracks(nextResults)
						: nextResults
				})
				setHasMore(moreResults)
				setUnavailablePlatforms((currentPlatforms) =>
					currentPage === 1
						? failedPlatforms
						: Array.from(new Set([...currentPlatforms, ...failedPlatforms])),
				)
				setPage(currentPage)
			} catch (error) {
				if (requestId !== searchRequestRef.current) return
				console.error('Error fetching search results:', error)
				setHasSearchError(true)
			} finally {
				if (requestId === searchRequestRef.current) {
					setIsLoading(false)
				}
			}
		},
		[],
	)

	useEffect(() => {
		cancelSearchRequest()
		setSearchResults([])
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
						hotSearches={hotSearches}
						isHotLoading={isHotLoading}
						hasHotError={hasHotError}
						onSearch={handleKeywordSearch}
						onRemoveHistory={handleRemoveHistory}
						onClearHistory={() => PersistStatus.set('search.history', [])}
						onRetryHotSearch={() => void loadHotSearches()}
					/>
				) : null}
				{showResults ? (
					<SearchList
						tracks={searchResults}
						query={submittedQuery}
						onLoadMore={handleLoadMore}
						onRetry={handleRetrySearch}
						hasMore={hasMore}
						hasError={hasSearchError}
						isLoading={isLoading}
						unavailablePlatforms={unavailablePlatforms}
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
	})

export default SearchScreen
