import TracksListItem from '@/components/TracksListItem'
import { unknownTrackImageUri } from '@/constants/images'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useQueue } from '@/store/queue'
import { useUtilsStyles } from '@/styles'
import { isSameMediaItem } from '@/utils/mediaItem'
import { FlashList, type FlashListProps } from '@shopify/flash-list'
import { router } from 'expo-router'
import React, { useCallback, useMemo } from 'react'
import { StyleProp, Text, View, ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import type { Track } from '@/player/types'
import { useIsPlaying } from '@rntp/player'
import { QueueControls } from './QueueControls'
import i18n from '@/utils/i18n'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
export type TracksListScrollProps = {
	style?: FlashListProps<Track>['style']
	contentContainerStyle?: FlashListProps<Track>['contentContainerStyle']
	contentInsetAdjustmentBehavior?: FlashListProps<Track>['contentInsetAdjustmentBehavior']
	refreshControl?: FlashListProps<Track>['refreshControl']
	onEndReached?: FlashListProps<Track>['onEndReached']
	onEndReachedThreshold?: FlashListProps<Track>['onEndReachedThreshold']
	ListEmptyComponent?: FlashListProps<Track>['ListEmptyComponent']
}

export type TracksListProps = TracksListScrollProps & {
	id: string
	tracks: Track[]
	scrollEnabled?: boolean
	hideQueueControls?: boolean
	ListHeaderComponent?: React.ReactNode
	ListFooterComponent?: React.ReactNode
	ListHeaderComponentStyle?: StyleProp<ViewStyle>
	isSinger?: boolean
	allowDelete?: boolean
	onDeleteTrack?: (track: Track) => void
	onReplaceSource?: (track: Track) => void
	isMultiSelectMode?: boolean
	selectedTracks?: Set<string>
	onToggleSelection?: (trackId: string) => void
	toggleMultiSelectMode?: () => void
	numsToPlay?: number
	showRank?: boolean
	onTrackPress?: () => void
}

const EMPTY_SET = new Set<string>()

export const TracksList = React.memo(
	({
		id,
		tracks,
		scrollEnabled = true,
		hideQueueControls = false,
		ListHeaderComponent,
		ListFooterComponent,
		ListHeaderComponentStyle,
		isSinger = false,
		allowDelete = false,
		isMultiSelectMode = false,
		onDeleteTrack,
		onReplaceSource,
		selectedTracks = EMPTY_SET,
		onToggleSelection,
		toggleMultiSelectMode,
		numsToPlay,
		showRank = false,
		onTrackPress,
		style,
		contentContainerStyle,
		contentInsetAdjustmentBehavior = 'automatic',
		refreshControl,
		onEndReached,
		onEndReachedThreshold,
		ListEmptyComponent,
	}: TracksListProps) => {
		const utilsStyles = useUtilsStyles()
		const { activeQueueId, setActiveQueueId } = useQueue()
		const currentMusic = myTrackPlayer.useCurrentMusic()
		const playing = useIsPlaying()
		const { bottom } = useSafeAreaInsets()

		const ItemDivider = useCallback(
			() => <View style={{ ...utilsStyles.itemSeparator, marginVertical: 9, marginLeft: 60 }} />,
			[utilsStyles],
		)
		const emptyListComponent = useMemo(
			() => (
				<View>
					<Text style={utilsStyles.emptyContentText}>{i18n.t('tracks.empty')}</Text>
					<Text
						style={[utilsStyles.emptyContentText, { fontSize: 14, marginTop: 4, opacity: 0.7 }]}
					>
						{i18n.t('tracks.emptyHint')}
					</Text>
					<Image
						accessible={false}
						contentFit="cover"
						cachePolicy="memory-disk"
						priority="normal"
						source={{ uri: unknownTrackImageUri }}
						style={utilsStyles.emptyContentImage}
					/>
				</View>
			),
			[utilsStyles],
		)

		const handleTrackSelect = useCallback(
			async (selectedTrack: Track) => {
				onTrackPress?.()
				const isCurrentTrack = isSameMediaItem(
					selectedTrack as IMusic.IMusicItem,
					currentMusic as IMusic.IMusicItem | null | undefined,
				)
				const isChangingQueue = id !== activeQueueId
				if (isChangingQueue) {
					if (isCurrentTrack) {
						router.navigate('/player')
					} else {
						await myTrackPlayer.playWithReplacePlayList(
							selectedTrack as IMusic.IMusicItem,
							(numsToPlay ? tracks.slice(0, numsToPlay) : tracks) as IMusic.IMusicItem[],
						)
						setActiveQueueId(id)
					}
				} else {
					if (isCurrentTrack) {
						router.navigate('/player')
					} else {
						await myTrackPlayer.playWithReplacePlayList(
							selectedTrack as IMusic.IMusicItem,
							tracks as IMusic.IMusicItem[],
						)
					}
				}
			},
			[id, activeQueueId, tracks, setActiveQueueId, currentMusic, numsToPlay, onTrackPress],
		)

		const renderItem = useCallback(
			({ item: track, index }: { item: Track; index: number }) => {
				const isActiveTrack = isSameMediaItem(
					track as IMusic.IMusicItem,
					currentMusic as IMusic.IMusicItem | null | undefined,
				)
				return (
					<TracksListItem
						track={track}
						onTrackSelect={handleTrackSelect}
						isActiveTrack={isActiveTrack}
						isPlaying={isActiveTrack && !!playing}
						rank={showRank ? index + 1 : undefined}
						isSinger={isSinger}
						allowDelete={allowDelete}
						onDeleteTrack={onDeleteTrack}
						onReplaceSource={onReplaceSource}
						isMultiSelectMode={isMultiSelectMode}
						onToggleSelection={onToggleSelection}
						selectedTracks={selectedTracks}
						toggleMultiSelectMode={toggleMultiSelectMode}
					/>
				)
			},
			[
				handleTrackSelect,
				currentMusic,
				playing,
				isSinger,
				showRank,
				allowDelete,
				onDeleteTrack,
				onReplaceSource,
				isMultiSelectMode,
				onToggleSelection,
				selectedTracks,
				toggleMultiSelectMode,
			],
		)

		const queueControlsHeader = useMemo(
			() =>
				!hideQueueControls ? (
					<QueueControls
						tracks={numsToPlay ? tracks.slice(0, numsToPlay) : tracks}
						style={{ paddingBottom: 20 }}
					/>
				) : undefined,
			[hideQueueControls, tracks, numsToPlay],
		)

		const combinedListHeader = useMemo(() => {
			if (!ListHeaderComponent && !queueControlsHeader) {
				return undefined
			}

			return (
				<View style={ListHeaderComponentStyle}>
					{ListHeaderComponent}
					{queueControlsHeader}
				</View>
			)
		}, [ListHeaderComponent, ListHeaderComponentStyle, queueControlsHeader])

		const listExtraData = useMemo(
			() => ({
				currentTrackId: currentMusic?.id ?? null,
				currentTrackPlatform: currentMusic?.platform ?? null,
				playing,
				isMultiSelectMode,
				selectedTrackIds: Array.from(selectedTracks),
			}),
			[currentMusic?.id, currentMusic?.platform, playing, isMultiSelectMode, selectedTracks],
		)

		const keyExtractor = useCallback((item: Track) => JSON.stringify([item.platform, item.id]), [])

		return (
			<FlashList
				style={{ flex: 1, ...style }}
				data={tracks}
				extraData={listExtraData}
				scrollEnabled={scrollEnabled}
				contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
				contentContainerStyle={[
					{ paddingTop: 10, paddingBottom: 128 + bottom },
					contentContainerStyle,
				]}
				refreshControl={refreshControl}
				onEndReached={onEndReached}
				onEndReachedThreshold={onEndReachedThreshold}
				ListHeaderComponent={combinedListHeader}
				ListFooterComponent={
					<View>
						{tracks.length > 0 ? <ItemDivider /> : null}
						{ListFooterComponent}
					</View>
				}
				ItemSeparatorComponent={ItemDivider}
				ListEmptyComponent={
					ListEmptyComponent === undefined ? emptyListComponent : ListEmptyComponent
				}
				renderItem={renderItem}
				keyExtractor={keyExtractor}
				maintainVisibleContentPosition={{ disabled: true }}
			/>
		)
	},
)
