import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useIsPlaying } from '@rntp/player'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	type StyleProp,
	type ImageStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { unknownArtistImageUri, unknownTrackImageUri } from '@/constants/images'
import { ThemeColors } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { getSearchEmptyState } from '@/helpers/searchResultState'
import { useThemeColors } from '@/hooks/useAppTheme'
import type { Track } from '@/player/types'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { isSameMediaItem } from '@/utils/mediaItem'
import TracksListItem from './TracksListItem'

export type SearchListProps = {
	tracks: Track[]
	query: string
	onLoadMore: () => void
	onRetry: () => void
	hasMore: boolean
	hasError: boolean
	isLoading: boolean
	unavailablePlatforms?: MusicPlatform[]
	pendingPlatforms?: MusicPlatform[]
	isFiltered?: boolean
	unfilteredCount?: number
	isCacheLoading?: boolean
	hasCacheError?: boolean
	onClearFilter?: () => void
	onRetryCache?: () => void
}

const PLATFORM_LABEL_KEYS: Record<MusicPlatform, string> = {
	tx: 'find.platformTx',
	kw: 'find.platformKw',
	kg: 'find.platformKg',
	wy: 'find.platformWy',
	mg: 'find.platformMg',
}

const ItemDivider = memo(() => {
	const colors = useThemeColors()
	return <View style={[styles.itemSeparator, { backgroundColor: colors.separator }]} />
})

const SearchArtwork = ({
	uri,
	artist = false,
	style,
}: {
	uri?: string
	artist?: boolean
	style: StyleProp<ImageStyle>
}) => {
	const fallbackUri = artist ? unknownArtistImageUri : unknownTrackImageUri
	const artworkUri = uri?.trim() || fallbackUri
	const [failedUri, setFailedUri] = useState<string | null>(null)

	return (
		<Image
			accessible={false}
			contentFit="cover"
			cachePolicy="memory-disk"
			placeholder={{ uri: fallbackUri }}
			placeholderContentFit="cover"
			recyclingKey={artworkUri}
			source={{ uri: failedUri === artworkUri ? fallbackUri : artworkUri }}
			onError={() => setFailedUri(artworkUri)}
			style={style}
		/>
	)
}

const formatCompactCount = (value: unknown) => {
	const count = Number(value)
	if (!Number.isFinite(count) || count < 0) return null

	const formatUnit = (amount: number, unit: string) =>
		`${Number.isInteger(amount) ? amount : amount.toFixed(1)}${unit}`
	if (i18n.locale.toLowerCase().startsWith('zh')) {
		if (count >= 100_000_000) return formatUnit(count / 100_000_000, '亿')
		if (count >= 10_000) return formatUnit(count / 10_000, '万')
	} else {
		if (count >= 1_000_000) return formatUnit(count / 1_000_000, 'M')
		if (count >= 1_000) return formatUnit(count / 1_000, 'K')
	}

	return String(Math.trunc(count))
}

const SearchResultState = ({
	query,
	isLoading,
	hasError,
	onRetry,
	isFiltered,
	unfilteredCount,
	isCacheLoading,
	hasCacheError,
	onClearFilter,
	onRetryCache,
}: Pick<
	SearchListProps,
	| 'query'
	| 'isLoading'
	| 'hasError'
	| 'onRetry'
	| 'isFiltered'
	| 'unfilteredCount'
	| 'isCacheLoading'
	| 'hasCacheError'
	| 'onClearFilter'
	| 'onRetryCache'
>) => {
	const colors = useThemeColors()
	const themedStyles = useMemo(() => createStyles(colors), [colors])
	const state = getSearchEmptyState({
		isLoading,
		hasError,
		isFiltered,
		unfilteredCount,
		isCacheLoading,
		hasCacheError,
	})
	const isFilterEmpty =
		state === 'filteredEmpty' ||
		state === 'cacheError' ||
		(state === 'searchError' && isFiltered && (unfilteredCount ?? 0) > 0)
	const isError = state === 'searchError' || state === 'cacheError'

	if (state === 'searching' || state === 'checkingCache') {
		return (
			<View style={themedStyles.stateContainer}>
				<ActivityIndicator size="large" color={colors.loading} />
				<Text style={themedStyles.stateTitle}>
					{i18n.t(state === 'checkingCache' ? 'find.checkingCache' : 'find.loadingResults')}
				</Text>
				{state === 'checkingCache' && onClearFilter ? (
					<Pressable
						accessibilityRole="button"
						onPress={onClearFilter}
						style={themedStyles.retryButton}
					>
						<Text style={themedStyles.retryText}>{i18n.t('find.clearFilter')}</Text>
					</Pressable>
				) : null}
			</View>
		)
	}

	return (
		<View style={themedStyles.stateContainer}>
			<MaterialCommunityIcons
				name={
					isError
						? 'cloud-alert-outline'
						: isFilterEmpty
							? 'filter-remove-outline'
							: 'magnify-close'
				}
				size={42}
				color={colors.textMuted}
			/>
			<Text style={themedStyles.stateTitle}>
				{state === 'cacheError'
					? i18n.t('find.cacheCheckFailed')
					: state === 'filteredEmpty'
						? i18n.t('find.noFilterResults')
						: isError
							? i18n.t('find.searchFailed')
							: i18n.t('find.noResultsFor', { keyword: query })}
			</Text>
			<Text style={themedStyles.stateDescription}>
				{isFilterEmpty
					? i18n.t(state === 'cacheError' ? 'find.cacheCheckHint' : 'find.clearFilterHint')
					: isError
						? i18n.t('find.checkNetwork')
						: i18n.t('find.tryAnotherKeyword')}
			</Text>
			{isFilterEmpty && onClearFilter ? (
				<Pressable
					accessibilityRole="button"
					onPress={onClearFilter}
					style={({ pressed }) => [themedStyles.retryButton, pressed && themedStyles.pressed]}
				>
					<Text style={themedStyles.retryText}>{i18n.t('find.clearFilter')}</Text>
				</Pressable>
			) : null}
			{isError ? (
				<Pressable
					accessibilityRole="button"
					onPress={state === 'cacheError' ? onRetryCache : onRetry}
					style={({ pressed }) => [themedStyles.retryButton, pressed && themedStyles.pressed]}
				>
					<Text style={themedStyles.retryText}>
						{i18n.t(state === 'cacheError' ? 'find.retryCacheCheck' : 'find.retry')}
					</Text>
				</Pressable>
			) : null}
		</View>
	)
}

const ResultsFooter = ({
	isLoading,
	hasMore,
	hasError,
	onRetry,
	isCacheLoading,
	hasCacheError,
	onRetryCache,
}: Pick<
	SearchListProps,
	| 'isLoading'
	| 'hasMore'
	| 'hasError'
	| 'onRetry'
	| 'isCacheLoading'
	| 'hasCacheError'
	| 'onRetryCache'
>) => {
	const colors = useThemeColors()
	const themedStyles = useMemo(() => createStyles(colors), [colors])

	if (isLoading) {
		return (
			<View style={themedStyles.footer}>
				<ActivityIndicator size="small" color={colors.loading} />
			</View>
		)
	}
	if (isCacheLoading) {
		return (
			<View style={themedStyles.footer}>
				<ActivityIndicator size="small" color={colors.primary} />
				<Text style={themedStyles.footerText}>{i18n.t('find.checkingCache')}</Text>
			</View>
		)
	}
	if (hasCacheError) {
		return (
			<Pressable accessibilityRole="button" onPress={onRetryCache} style={themedStyles.footer}>
				<MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
				<Text style={themedStyles.footerAction}>{i18n.t('find.cacheCheckPartial')}</Text>
			</Pressable>
		)
	}
	if (hasError) {
		return (
			<Pressable
				accessibilityRole="button"
				onPress={onRetry}
				style={({ pressed }) => [themedStyles.footer, pressed && themedStyles.pressed]}
			>
				<MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
				<Text style={themedStyles.footerAction}>{i18n.t('find.loadMoreFailed')}</Text>
			</Pressable>
		)
	}
	if (!hasMore) {
		return (
			<View style={themedStyles.footer}>
				<Text style={themedStyles.footerText}>{i18n.t('find.endOfResults')}</Text>
			</View>
		)
	}
	return null
}

const PartialResultsNotice = ({ platforms }: { platforms: MusicPlatform[] }) => {
	const colors = useThemeColors()
	const themedStyles = useMemo(() => createStyles(colors), [colors])
	if (platforms.length === 0) return null

	return (
		<View style={themedStyles.partialNotice}>
			<MaterialCommunityIcons name="alert-circle-outline" size={18} color={colors.textMuted} />
			<Text style={themedStyles.partialNoticeText}>
				{i18n.t('find.partialResults', {
					platforms: platforms
						.map((platform) => i18n.t(PLATFORM_LABEL_KEYS[platform]))
						.join(i18n.locale.toLowerCase().startsWith('zh') ? '、' : ', '),
				})}
			</Text>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		playlistItem: {
			minHeight: 78,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 12,
			paddingVertical: 8,
		},
		playlistArtwork: {
			width: 62,
			height: 62,
			borderRadius: 14,
			backgroundColor: colors.artworkPlaceholder,
		},
		playlistContent: {
			flex: 1,
			minWidth: 0,
			gap: 3,
		},
		playlistTitle: {
			fontSize: 16,
			lineHeight: 22,
			fontWeight: '600',
			color: colors.text,
		},
		playlistCreator: {
			fontSize: 13,
			lineHeight: 19,
			color: colors.textMuted,
		},
		playlistMeta: {
			fontSize: 12,
			lineHeight: 18,
			color: colors.textMuted,
		},
		partialNotice: {
			minHeight: 38,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
			marginBottom: 8,
			paddingHorizontal: 12,
			paddingVertical: 8,
			borderRadius: 14,
			backgroundColor: colors.surfaceMuted,
		},
		partialNoticeText: {
			flex: 1,
			color: colors.textMuted,
			fontSize: 12,
			lineHeight: 18,
		},
		artistItem: {
			minHeight: 72,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 12,
			paddingVertical: 8,
		},
		artistAvatar: {
			width: 50,
			height: 50,
			borderRadius: 25,
			backgroundColor: colors.artworkPlaceholder,
		},
		artistContent: {
			flex: 1,
			minWidth: 0,
			gap: 3,
		},
		artistName: {
			fontSize: 16,
			lineHeight: 22,
			fontWeight: '600',
			color: colors.text,
		},
		artistMeta: {
			fontSize: 13,
			lineHeight: 19,
			color: colors.textMuted,
		},
		stateContainer: {
			minHeight: 260,
			alignItems: 'center',
			justifyContent: 'center',
			paddingHorizontal: 18,
			paddingVertical: 24,
			gap: 10,
		},
		stateTitle: {
			color: colors.text,
			fontSize: 17,
			lineHeight: 24,
			fontWeight: '600',
			textAlign: 'center',
		},
		stateDescription: {
			color: colors.textMuted,
			fontSize: 14,
			lineHeight: 21,
			textAlign: 'center',
		},
		retryButton: {
			minWidth: 96,
			minHeight: 44,
			alignItems: 'center',
			justifyContent: 'center',
			marginTop: 6,
			paddingHorizontal: 18,
			borderRadius: 22,
			backgroundColor: colors.primary,
		},
		retryText: {
			color: '#ffffff',
			fontSize: 14,
			fontWeight: '600',
		},
		footer: {
			minHeight: 52,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 7,
		},
		footerText: {
			color: colors.textMuted,
			fontSize: 13,
		},
		footerAction: {
			color: colors.primary,
			fontSize: 13,
			fontWeight: '500',
		},
		pressed: {
			opacity: 0.55,
		},
	})

const styles = StyleSheet.create({
	itemSeparator: {
		height: StyleSheet.hairlineWidth,
		marginVertical: 4,
	},
})

export const SearchList = ({
	tracks,
	query,
	onLoadMore,
	onRetry,
	hasMore,
	hasError,
	isLoading,
	unavailablePlatforms = [],
	pendingPlatforms = [],
	isFiltered = false,
	unfilteredCount = tracks.length,
	isCacheLoading = false,
	hasCacheError = false,
	onClearFilter,
	onRetryCache,
}: SearchListProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const themedStyles = useMemo(() => createStyles(colors), [colors])
	const currentMusic = myTrackPlayer.useCurrentMusic()
	const playing = useIsPlaying()
	const insets = useSafeAreaInsets()

	const handleTrackSelect = useCallback(async (selectedTrack: Track) => {
		if (selectedTrack.isPlaylist) {
			router.navigate({
				pathname: '/(tabs)/search/[name]',
				params: {
					name: String(selectedTrack.id),
					title: String(selectedTrack.title ?? ''),
				},
			})
			return
		}
		if (selectedTrack.isArtist) {
			const singerMid = selectedTrack.singerMID || selectedTrack.id
			if (singerMid) {
				router.navigate(`/(modals)/${singerMid}`)
			}
			return
		}
		await myTrackPlayer.play(selectedTrack as IMusic.IMusicItem)
	}, [])

	const renderItem = useCallback(
		({ item: track }: { item: Track }) => {
			if (track.isPlaylist) {
				const songs = formatCompactCount(track.worksNum)
				const plays = formatCompactCount(track.playCount)
				const metadata = [
					songs ? i18n.t('find.playlistSongs', { songs }) : null,
					plays ? i18n.t('find.playlistPlays', { plays }) : null,
				].filter(Boolean)

				return (
					<TouchableOpacity
						accessibilityRole="button"
						activeOpacity={0.65}
						style={themedStyles.playlistItem}
						onPress={() => handleTrackSelect(track)}
					>
						<SearchArtwork uri={track.artwork} style={themedStyles.playlistArtwork} />
						<View style={themedStyles.playlistContent}>
							<Text style={themedStyles.playlistTitle} numberOfLines={2}>
								{track.title}
							</Text>
							{track.artist ? (
								<Text style={themedStyles.playlistCreator} numberOfLines={1}>
									{track.artist}
								</Text>
							) : null}
							{metadata.length > 0 ? (
								<Text style={themedStyles.playlistMeta} numberOfLines={1}>
									{metadata.join(' · ')}
								</Text>
							) : null}
						</View>
						<MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
					</TouchableOpacity>
				)
			}
			if (track.isArtist) {
				return (
					<TouchableOpacity
						accessibilityRole="button"
						activeOpacity={0.65}
						style={themedStyles.artistItem}
						onPress={() => handleTrackSelect(track)}
					>
						<SearchArtwork uri={track.artwork} artist style={themedStyles.artistAvatar} />
						<View style={themedStyles.artistContent}>
							<Text style={themedStyles.artistName} numberOfLines={2}>
								{track.title}
							</Text>
							{track.worksNum ? (
								<Text style={themedStyles.artistMeta} numberOfLines={1}>
									{i18n.t('find.artistWorks', { works: track.worksNum })}
								</Text>
							) : null}
						</View>
						<MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
					</TouchableOpacity>
				)
			}
			const isActiveTrack =
				isSameMediaItem(
					track as IMusic.IMusicItem,
					currentMusic as IMusic.IMusicItem | null | undefined,
				) ||
				track.sourceAlternatives?.some((alternative) =>
					isSameMediaItem(
						alternative as IMusic.IMusicItem,
						currentMusic as IMusic.IMusicItem | null | undefined,
					),
				)
			return (
				<TracksListItem
					track={track}
					onTrackSelect={handleTrackSelect}
					isActiveTrack={isActiveTrack}
					isPlaying={isActiveTrack && !!playing}
					showSourceBadge
					showLibraryStatus
				/>
			)
		},
		[colors.textMuted, currentMusic, handleTrackSelect, playing, themedStyles],
	)

	const keyExtractor = useCallback(
		(item: Track, index: number) =>
			`${item.isPlaylist ? 'playlist' : item.isArtist ? 'artist' : 'song'}-${item.platform ?? 'unknown'}-${item.id}-${index}`,
		[],
	)

	const handleEndReached = useCallback(() => {
		if (isFiltered && tracks.length === 0) return
		if (hasMore && !hasError && !isLoading) {
			onLoadMore()
		}
	}, [hasError, hasMore, isFiltered, isLoading, onLoadMore, tracks.length])

	const footerComponent = useMemo(() => {
		if (tracks.length > 0)
			return (
				<ResultsFooter
					isLoading={isLoading}
					hasMore={hasMore}
					hasError={hasError}
					onRetry={onRetry}
					isCacheLoading={isCacheLoading}
					hasCacheError={hasCacheError}
					onRetryCache={onRetryCache}
				/>
			)
		if (isFiltered && unfilteredCount > 0 && hasMore && !isLoading && !isCacheLoading && !hasError)
			return (
				<Pressable accessibilityRole="button" onPress={onLoadMore} style={themedStyles.footer}>
					<Text style={themedStyles.footerAction}>{i18n.t('find.loadMoreFilteredResults')}</Text>
				</Pressable>
			)
		return null
	}, [
		hasCacheError,
		hasError,
		hasMore,
		isCacheLoading,
		isFiltered,
		isLoading,
		onLoadMore,
		onRetry,
		onRetryCache,
		themedStyles,
		tracks.length,
		unfilteredCount,
	])

	return (
		<View style={defaultStyles.container}>
			<FlashList
				data={tracks}
				extraData={{
					currentTrackId: currentMusic?.id ?? null,
					currentTrackPlatform: currentMusic?.platform ?? null,
					playing,
				}}
				contentContainerStyle={{
					paddingTop: 8,
					paddingBottom: 128 + insets.bottom,
					paddingHorizontal: 18,
				}}
				ItemSeparatorComponent={ItemDivider}
				ListEmptyComponent={
					<SearchResultState
						query={query}
						isLoading={isLoading}
						hasError={hasError}
						onRetry={onRetry}
						isFiltered={isFiltered}
						unfilteredCount={unfilteredCount}
						isCacheLoading={isCacheLoading}
						hasCacheError={hasCacheError}
						onClearFilter={onClearFilter}
						onRetryCache={onRetryCache}
					/>
				}
				ListHeaderComponent={
					tracks.length > 0 ? (
						<View>
							<PartialResultsNotice platforms={unavailablePlatforms} />
							{pendingPlatforms.length ? (
								<View
									style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
								>
									<ActivityIndicator size="small" color={colors.primary} />
									<Text style={{ color: colors.textMuted, fontSize: 12, flex: 1 }}>
										{i18n.t('find.pendingResults', {
											platforms: pendingPlatforms
												.map((platform) => i18n.t(PLATFORM_LABEL_KEYS[platform]))
												.join(' · '),
										})}
									</Text>
								</View>
							) : null}
						</View>
					) : null
				}
				renderItem={renderItem}
				keyExtractor={keyExtractor}
				onEndReached={handleEndReached}
				onEndReachedThreshold={0.15}
				ListFooterComponent={footerComponent}
				maintainVisibleContentPosition={{ disabled: true }}
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
			/>
		</View>
	)
}

export default memo(SearchList)
