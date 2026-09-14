import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors, screenPadding } from '@/constants/tokens'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useUtilsStyles } from '@/styles'
import { isSameMediaItem } from '@/utils/mediaItem'
import i18n from '@/utils/i18n'
import { showToast } from '@/utils/utils'
import { FlashList, type FlashListRef } from '@shopify/flash-list'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import type { Track } from '@/player/types'
import { useIsPlaying } from '@rntp/player'
import TracksListItem from './TracksListItem'

export type TracksListProps = {
	id: string
	tracks: Track[]
	hideQueueControls?: boolean
}

const ItemDivider = React.memo(() => {
	const colors = useThemeColors()
	const utilsStyles = useUtilsStyles()
	const styles = useMemo(() => createStyles(colors, utilsStyles), [colors, utilsStyles])

	return <View style={styles.itemDivider} />
})

const EmptyListComponent = React.memo(() => {
	const utilsStyles = useUtilsStyles()

	return (
		<View>
			<Text style={utilsStyles.emptyContentText}>{i18n.t('queue.empty')}</Text>
			<Image
				contentFit="cover"
				cachePolicy="memory-disk"
				priority="normal"
				source={{ uri: unknownTrackImageUri }}
				style={utilsStyles.emptyContentImage}
			/>
		</View>
	)
})

export const NowPlayList = React.memo(({ tracks }: TracksListProps) => {
	const colors = useThemeColors()
	const utilsStyles = useUtilsStyles()
	const styles = useMemo(() => createStyles(colors, utilsStyles), [colors, utilsStyles])
	const listRef = useRef<FlashListRef<Track>>(null)
	const currentMusic = myTrackPlayer.useCurrentMusic()
	const playing = useIsPlaying()
	const [editingOrder, setEditingOrder] = useState(false)

	const initialIndex = useMemo(
		() =>
			currentMusic
				? tracks.findIndex((track) =>
						isSameMediaItem(
							track as IMusic.IMusicItem,
							currentMusic as IMusic.IMusicItem | null | undefined,
						),
					)
				: -1,
		[currentMusic, tracks],
	)

	const handleTrackSelect = useCallback(async (selectedTrack: Track) => {
		await myTrackPlayer.play(selectedTrack as IMusic.IMusicItem)
	}, [])

	const renderItem = useCallback(
		({ item: track, index }: { item: Track; index: number }) => {
			const isActiveTrack = isSameMediaItem(
				track as IMusic.IMusicItem,
				currentMusic as IMusic.IMusicItem | null | undefined,
			)
			return (
				<View style={styles.editableRow}>
					<View style={styles.trackItem}>
						<TracksListItem
							track={track}
							onTrackSelect={handleTrackSelect}
							isActiveTrack={isActiveTrack}
							isPlaying={isActiveTrack && !!playing}
						/>
					</View>
					{editingOrder ? (
						<View style={styles.orderActions}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={i18n.t('queue.moveUp')}
								disabled={index === 0}
								onPress={() => myTrackPlayer.moveQueueTrack(index, index - 1)}
								style={styles.orderButton}
							>
								<Text style={[styles.orderText, index === 0 && styles.disabled]}>↑</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={i18n.t('queue.moveDown')}
								disabled={index === tracks.length - 1}
								onPress={() => myTrackPlayer.moveQueueTrack(index, index + 1)}
								style={styles.orderButton}
							>
								<Text style={[styles.orderText, index === tracks.length - 1 && styles.disabled]}>
									↓
								</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={i18n.t('queue.remove')}
								onPress={() => void myTrackPlayer.remove(track as IMusic.IMusicItem)}
								style={styles.orderButton}
							>
								<Text style={styles.removeText}>−</Text>
							</Pressable>
						</View>
					) : null}
				</View>
			)
		},
		[handleTrackSelect, currentMusic, editingOrder, playing, styles, tracks.length],
	)

	const keyExtractor = useCallback((item: Track) => `${item.platform}:${item.id}`, [])

	useEffect(() => {
		if (initialIndex > 0) {
			setTimeout(() => {
				listRef.current?.scrollToIndex({
					index: initialIndex,
					animated: false,
					viewPosition: 0.5,
				})
			}, 100)
		}
	}, [initialIndex])

	const saveQueue = useCallback(() => {
		if (!tracks.length) return
		const save = (name?: string) => {
			const title = name?.trim()
			if (!title) return
			const result = myTrackPlayer.addPlayLists({
				id: `queue-${Date.now()}`,
				platform: 'local',
				artist: i18n.t('queue.savedFromQueue'),
				name: title,
				title,
				artwork: tracks[0]?.artwork || unknownTrackImageUri,
				songs: tracks as IMusic.IMusicItem[],
			})
			if (result === 'success') showToast(i18n.t('queue.saved'), title)
			else showToast(i18n.t('queue.saveFailed'), undefined, 'error')
		}
		if (Platform.OS === 'ios') {
			Alert.prompt(i18n.t('queue.saveTitle'), i18n.t('queue.saveMessage'), save, 'plain-text')
		}
	}, [tracks])

	const clearWaiting = useCallback(() => {
		Alert.alert(i18n.t('queue.clearTitle'), i18n.t('queue.clearMessage'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('queue.clear'),
				style: 'destructive',
				onPress: () => void myTrackPlayer.clearToBePlayed(),
			},
		])
	}, [])

	const listExtraData = useMemo(
		() => ({
			currentTrackId: currentMusic?.id ?? null,
			currentTrackPlatform: currentMusic?.platform ?? null,
			playing,
		}),
		[currentMusic?.id, currentMusic?.platform, playing],
	)

	return (
		<>
			<View style={styles.dismissPlayerSymbol}>
				<View style={styles.dismissPlayerBar} />
				<View style={styles.headerRow}>
					<Text style={styles.header}>{i18n.t('queue.title', { count: tracks.length })}</Text>
					<View style={styles.headerActions}>
						<Pressable accessibilityRole="button" onPress={saveQueue} hitSlop={8}>
							<Text style={styles.headerActionText}>{i18n.t('queue.save')}</Text>
						</Pressable>
						<Pressable accessibilityRole="button" onPress={clearWaiting} hitSlop={8}>
							<Text style={styles.headerActionText}>{i18n.t('queue.clear')}</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							onPress={() => setEditingOrder((value) => !value)}
							hitSlop={8}
						>
							<Text style={styles.headerActionText}>
								{editingOrder ? i18n.t('queue.done') : i18n.t('queue.edit')}
							</Text>
						</Pressable>
					</View>
				</View>
			</View>
			<View style={styles.listContainer}>
				<FlashList
					data={tracks}
					extraData={listExtraData}
					contentContainerStyle={styles.contentContainer}
					ListFooterComponent={<ItemDivider />}
					ItemSeparatorComponent={ItemDivider}
					ref={listRef}
					ListEmptyComponent={<EmptyListComponent />}
					renderItem={renderItem}
					keyExtractor={keyExtractor}
					maintainVisibleContentPosition={{ disabled: true }}
				/>
			</View>
		</>
	)
})

const createStyles = (colors: ThemeColors, utilsStyles: ReturnType<typeof useUtilsStyles>) =>
	StyleSheet.create({
		listContainer: {
			flex: 1,
			paddingHorizontal: screenPadding.horizontal,
		},
		contentContainer: {
			paddingBottom: 128,
		},
		itemDivider: {
			...utilsStyles.itemSeparator,
			marginVertical: 9,
			marginLeft: 60,
		},
		dismissPlayerSymbol: {
			paddingTop: 10,
			backgroundColor: colors.overlayStrong,
		},
		dismissPlayerBar: {
			width: 50,
			height: 4,
			borderRadius: 2,
			backgroundColor: colors.text,
			opacity: 0.3,
			alignSelf: 'center',
			marginBottom: 10,
		},
		header: {
			fontSize: 23,
			fontWeight: 'bold',
			color: colors.text,
		},
		headerRow: {
			alignItems: 'center',
			flexDirection: 'row',
			justifyContent: 'space-between',
			paddingBottom: 10,
			paddingHorizontal: 20,
		},
		headerActions: { flexDirection: 'row', gap: 14 },
		headerActionText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
		editableRow: { alignItems: 'center', flexDirection: 'row' },
		trackItem: { flex: 1 },
		orderActions: { alignItems: 'center', flexDirection: 'row' },
		orderButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 34 },
		orderText: { color: colors.primary, fontSize: 20, fontWeight: '600' },
		removeText: { color: colors.error, fontSize: 24, fontWeight: '600' },
		disabled: { color: colors.textMuted, opacity: 0.35 },
	})
