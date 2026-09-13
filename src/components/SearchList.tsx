import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useIsPlaying } from '@rntp/player'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { memo, useCallback, useMemo } from 'react'
import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors, screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
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
}: Pick<SearchListProps, 'query' | 'isLoading' | 'hasError' | 'onRetry'>) => {
	const colors = useThemeColors()
	const themedStyles = useMemo(() => createStyles(colors), [colors])

	if (isLoading) {
		return (
			<View style={themedStyles.stateContainer}>
				<ActivityIndicator size="large" color={colors.loading} />
				<Text style={themedStyles.stateTitle}>{i18n.t('find.loadingResults')}</Text>
			</View>
		)
	}

	return (
		<View style={themedStyles.stateContainer}>
			<MaterialCommunityIcons
				name={hasError ? 'cloud-alert-outline' : 'magnify-close'}
				size={42}
				color={colors.textMuted}
			/>
			<Text style={themedStyles.stateTitle}>
				{hasError ? i18n.t('find.searchFailed') : i18n.t('find.noResultsFor', { keyword: query })}
			</Text>
			<Text style={themedStyles.stateDescription}>
				{hasError ? i18n.t('find.checkNetwork') : i18n.t('find.tryAnotherKeyword')}
			</Text>
			{hasError ? (
				<Pressable
					accessibilityRole="button"
					onPress={onRetry}
					style={({ pressed }) => [themedStyles.retryButton, pressed && themedStyles.pressed]}
				>
					<Text style={themedStyles.retryText}>{i18n.t('find.retry')}</Text>
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
}: Pick<SearchListProps, 'isLoading' | 'hasMore' | 'hasError' | 'onRetry'>) => {
	const colors = useThemeColors()
	const themedStyles = useMemo(() => createStyles(colors), [colors])

	if (isLoading) {
		return (
			<View style={themedStyles.footer}>
				<ActivityIndicator size="small" color={colors.loading} />
			</View>
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
			minHeight: 68,
			flexDirection: 'row',
			alignItems: 'center',
		},
		playlistArtwork: {
			width: 62,
			height: 62,
			borderRadius: 8,
			marginRight: 13,
			backgroundColor: colors.artworkPlaceholder,
		},
		playlistContent: {
			flex: 1,
			gap: 3,
		},
		playlistTitle: {
			fontSize: 16,
			fontWeight: '600',
			color: colors.text,
		},
		playlistCreator: {
			fontSize: 13,
			color: colors.textMuted,
		},
		playlistMeta: {
			fontSize: 12,
			color: colors.textMuted,
		},
		partialNotice: {
			minHeight: 38,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 8,
			marginBottom: 8,
			paddingHorizontal: 12,
			borderRadius: 10,
			backgroundColor: colors.surfaceMuted,
		},
		partialNoticeText: {
			flex: 1,
			color: colors.textMuted,
			fontSize: 12,
		},
		artistItem: {
			minHeight: 58,
			flexDirection: 'row',
			alignItems: 'center',
		},
		artistAvatar: {
			width: 50,
			height: 50,
			borderRadius: 25,
			marginRight: 13,
			backgroundColor: colors.artworkPlaceholder,
		},
		artistContent: {
			flex: 1,
			gap: 3,
		},
		artistName: {
			fontSize: 16,
			fontWeight: '600',
			color: colors.text,
		},
		artistMeta: {
			fontSize: 13,
			color: colors.textMuted,
		},
		stateContainer: {
			minHeight: 320,
			alignItems: 'center',
			justifyContent: 'center',
			paddingHorizontal: 32,
			gap: 10,
		},
		stateTitle: {
			color: colors.text,
			fontSize: 17,
			fontWeight: '600',
			textAlign: 'center',
		},
		stateDescription: {
			color: colors.textMuted,
			fontSize: 14,
			textAlign: 'center',
		},
		retryButton: {
			minWidth: 96,
			minHeight: 40,
			alignItems: 'center',
			justifyContent: 'center',
			marginTop: 6,
			paddingHorizontal: 18,
			borderRadius: 20,
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
		marginVertical: 8,
		marginLeft: 63,
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
						activeOpacity={0.65}
						style={themedStyles.playlistItem}
						onPress={() => handleTrackSelect(track)}
					>
						<Image
							contentFit="cover"
							cachePolicy="memory-disk"
							recyclingKey={(track.artwork || unknownTrackImageUri) ?? 'missing-artwork'}
							source={{ uri: track.artwork || unknownTrackImageUri }}
							style={themedStyles.playlistArtwork}
						/>
						<View style={themedStyles.playlistContent}>
							<Text style={themedStyles.playlistTitle} numberOfLines={1}>
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
						activeOpacity={0.65}
						style={themedStyles.artistItem}
						onPress={() => handleTrackSelect(track)}
					>
						<Image
							contentFit="cover"
							cachePolicy="memory-disk"
							recyclingKey={(track.artwork || unknownTrackImageUri) ?? 'missing-artwork'}
							source={{ uri: track.artwork || unknownTrackImageUri }}
							style={themedStyles.artistAvatar}
						/>
						<View style={themedStyles.artistContent}>
							<Text style={themedStyles.artistName} numberOfLines={1}>
								{track.title}
							</Text>
							{track.worksNum ? (
								<Text style={themedStyles.artistMeta}>
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
		if (hasMore && !hasError && !isLoading) {
			onLoadMore()
		}
	}, [hasError, hasMore, isLoading, onLoadMore])

	const footerComponent = useMemo(
		() =>
			tracks.length > 0 ? (
				<ResultsFooter
					isLoading={isLoading}
					hasMore={hasMore}
					hasError={hasError}
					onRetry={onRetry}
				/>
			) : null,
		[hasError, hasMore, isLoading, onRetry, tracks.length],
	)

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
					paddingHorizontal: screenPadding.horizontal,
				}}
				ItemSeparatorComponent={ItemDivider}
				ListEmptyComponent={
					<SearchResultState
						query={query}
						isLoading={isLoading}
						hasError={hasError}
						onRetry={onRetry}
					/>
				}
				ListHeaderComponent={
					tracks.length > 0 ? <PartialResultsNotice platforms={unavailablePlatforms} /> : null
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
