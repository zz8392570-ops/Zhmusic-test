import { ThemeColors } from '@/constants/tokens'
import { useThemeColors } from '@/hooks/useAppTheme'
import myTrackPlayer, { MusicRepeatMode, repeatModeStore } from '@/helpers/trackPlayerIndex'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { Ionicons } from '@expo/vector-icons'
import shuffle from 'lodash.shuffle'
import { useMemo } from 'react'
import { Alert, StyleSheet, Text, View, ViewProps, TouchableOpacity } from 'react-native'
import type { Track } from '@/player/types'
import { hapticLight, hapticSelection } from '@/utils/haptics'

type QueueControlsProps = {
	tracks: Track[]
	showImportMenu?: boolean
	onImportTrack?: () => void
	isMultiSelectMode?: boolean
	onSelectAll?: () => void
	isAllSelected?: boolean
	hasSelection?: boolean
	deleteSelectedTracks?: () => void
	exportSelectedTracks?: () => void
} & ViewProps

export const QueueControls = ({
	tracks,
	style,
	showImportMenu,
	onImportTrack,
	isMultiSelectMode = false,
	onSelectAll,
	isAllSelected = false,
	hasSelection = false,
	deleteSelectedTracks,
	exportSelectedTracks,
	...viewProps
}: QueueControlsProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	const isEmpty = tracks.length === 0
	const downloadable = tracks.filter(
		(track) => track.platform !== 'local' && !String(track.url ?? '').includes('/musicCache/'),
	)
	const handlePlay = async () => {
		if (isEmpty) return
		hapticLight()
		await myTrackPlayer.playWithReplacePlayList(
			tracks[0] as IMusic.IMusicItem,
			tracks as IMusic.IMusicItem[],
		)
		myTrackPlayer.setRepeatMode(MusicRepeatMode.QUEUE)
	}

	const handleShufflePlay = async () => {
		if (isEmpty) return
		hapticLight()
		const shuffledTracks = shuffle(tracks)
		repeatModeStore.setValue(MusicRepeatMode.SHUFFLE)
		await myTrackPlayer.playWithReplacePlayList(
			shuffledTracks[0] as IMusic.IMusicItem,
			shuffledTracks as IMusic.IMusicItem[],
		)
	}

	return (
		<View style={[{ flexDirection: 'row', columnGap: 16 }, style]} {...viewProps}>
			{/* Play button */}
			<View style={{ flex: 1 }}>
				{isMultiSelectMode ? (
					<TouchableOpacity
						onPress={() => {
							hapticSelection()
							onSelectAll?.()
						}}
						activeOpacity={0.8}
						style={[styles.button, isEmpty && styles.buttonDisabled]}
						disabled={isEmpty}
						accessibilityRole="button"
						accessibilityLabel={
							isAllSelected ? i18n.t('playButton.cancel') : i18n.t('playButton.selectAll')
						}
						accessibilityState={{ disabled: isEmpty, selected: isAllSelected }}
					>
						<Ionicons
							name={isAllSelected ? 'checkbox-outline' : 'square-outline'}
							size={24}
							color={colors.primary}
						/>
						<Text style={styles.buttonText}>
							{isAllSelected ? i18n.t('playButton.cancel') : i18n.t('playButton.selectAll')}
						</Text>
					</TouchableOpacity>
				) : (
					<TouchableOpacity
						onPress={handlePlay}
						activeOpacity={0.8}
						style={[styles.button, isEmpty && styles.buttonDisabled]}
						disabled={isEmpty}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playButton.play')}
						accessibilityState={{ disabled: isEmpty }}
					>
						<Ionicons name="play" size={22} color={colors.primary} />

						<Text style={styles.buttonText}>{i18n.t('playButton.play')}</Text>
					</TouchableOpacity>
				)}
			</View>

			{/* Shuffle button */}
			{!isMultiSelectMode ? (
				<View style={{ flex: 1 }}>
					<TouchableOpacity
						onPress={handleShufflePlay}
						activeOpacity={0.8}
						style={[styles.button, isEmpty && styles.buttonDisabled]}
						disabled={isEmpty}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playButton.shuffle')}
						accessibilityState={{ disabled: isEmpty }}
					>
						<Ionicons name={'shuffle-sharp'} size={24} color={colors.primary} />

						<Text style={styles.buttonText}>{i18n.t('playButton.shuffle')}</Text>
					</TouchableOpacity>
				</View>
			) : (
				<View style={{ flex: 1 }}>
					<TouchableOpacity
						onPress={() => {
							hapticSelection()
							deleteSelectedTracks?.()
						}}
						activeOpacity={0.8}
						style={[styles.button, !hasSelection && styles.buttonDisabled]}
						disabled={!hasSelection}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playButton.delete')}
						accessibilityState={{ disabled: !hasSelection }}
					>
						<Ionicons name={'trash-outline'} size={24} color={colors.primary} />

						<Text style={styles.buttonText}>{i18n.t('playButton.delete')}</Text>
					</TouchableOpacity>
				</View>
			)}
			{/* import button */}
			{!isMultiSelectMode && downloadable.length > 0 && !showImportMenu ? (
				<TouchableOpacity
					accessibilityRole="button"
					accessibilityLabel={i18n.t('cacheCenter.downloadAll')}
					style={[styles.button, { minHeight: 48, paddingHorizontal: 10 }]}
					onPress={() =>
						Alert.alert(
							i18n.t('cacheCenter.downloadAll'),
							i18n.t('cacheCenter.batchMessage', { count: downloadable.length }),
							[
								{ text: i18n.t('find.cancel'), style: 'cancel' },
								{
									text: i18n.t('player.download'),
									onPress: () => void myTrackPlayer.downloadPlaylist(tracks as IMusic.IMusicItem[]),
								},
							],
						)
					}
				>
					<Ionicons name="download-outline" size={23} color={colors.primary} />
				</TouchableOpacity>
			) : null}
			{showImportMenu && (
				<View style={{ flex: 1 }}>
					{isMultiSelectMode ? (
						<TouchableOpacity
							onPress={() => {
								hapticSelection()
								exportSelectedTracks?.()
							}}
							activeOpacity={0.8}
							style={[styles.button, !hasSelection && styles.buttonDisabled]}
							disabled={!hasSelection}
							accessibilityRole="button"
							accessibilityLabel={i18n.t('playButton.out')}
							accessibilityState={{ disabled: !hasSelection }}
						>
							<Ionicons name={'exit-outline'} size={24} color={colors.primary} />

							<Text style={styles.buttonText}>{i18n.t('playButton.out')}</Text>
						</TouchableOpacity>
					) : (
						<TouchableOpacity
							onPress={() => {
								hapticSelection()
								onImportTrack?.()
							}}
							activeOpacity={0.8}
							style={styles.button}
							accessibilityRole="button"
							accessibilityLabel={i18n.t('playButton.import')}
						>
							<Ionicons name={'enter-outline'} size={24} color={colors.primary} />

							<Text style={styles.buttonText}>{i18n.t('playButton.import')}</Text>
						</TouchableOpacity>
					)}
				</View>
			)}
		</View>
	)
}

const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		button: {
			padding: 12,
			backgroundColor: colors.surfaceMuted,
			borderRadius: 10,
			borderCurve: 'continuous',
			flexDirection: 'row',
			justifyContent: 'center',
			alignItems: 'center',
			columnGap: 8,
		},
		buttonText: {
			...defaultStyles.text,
			color: colors.primary,
			fontWeight: '600',
			fontSize: 17,
			textAlign: 'center',
		},
		buttonDisabled: {
			opacity: 0.45,
		},
	})
