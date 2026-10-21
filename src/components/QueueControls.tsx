import { confirmPlaylistDownload } from '@/helpers/confirmPlaylistDownload'
import { ThemeColors } from '@/constants/tokens'
import { useThemeColors } from '@/hooks/useAppTheme'
import myTrackPlayer, { MusicRepeatMode } from '@/helpers/trackPlayerIndex'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { Ionicons } from '@expo/vector-icons'
import shuffle from 'lodash.shuffle'
import { useMemo } from 'react'
import { StyleSheet, Text, View, ViewProps, TouchableOpacity } from 'react-native'
import type { Track } from '@/player/types'
import type { MenuAction } from '@react-native-menu/menu'
import { MenuView } from '@/components/ActionMenu'
import { hapticLight, hapticSelection } from '@/utils/haptics'
import { getDownloadQuality, getDownloadQualityActions } from '@/helpers/downloadQuality'

type QueueControlsProps = {
	tracks: Track[]
	showImportMenu?: boolean
	onImportTrack?: () => void
	importLabel?: string
	isMultiSelectMode?: boolean
	onSelectAll?: () => void
	isAllSelected?: boolean
	hasSelection?: boolean
	deleteSelectedTracks?: () => void
	exportSelectedTracks?: () => void
	managementActions?: MenuAction[]
	onManagementAction?: (actionId: string) => void
	onSelectedAction?: (actionId: 'add' | 'move' | 'top' | 'bottom') => void
} & ViewProps

export const QueueControls = ({
	tracks,
	style,
	showImportMenu,
	onImportTrack,
	importLabel,
	isMultiSelectMode = false,
	onSelectAll,
	isAllSelected = false,
	hasSelection = false,
	deleteSelectedTracks,
	exportSelectedTracks,
	managementActions,
	onManagementAction,
	onSelectedAction,
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
		myTrackPlayer.setRepeatMode(MusicRepeatMode.QUEUE)
		await myTrackPlayer.playWithReplacePlayList(
			tracks[0] as IMusic.IMusicItem,
			tracks as IMusic.IMusicItem[],
			true,
		)
	}

	const handleShufflePlay = async () => {
		if (isEmpty) return
		hapticLight()
		const shuffledTracks = shuffle(tracks)
		myTrackPlayer.setRepeatMode(MusicRepeatMode.SHUFFLE)
		await myTrackPlayer.playWithReplacePlayList(
			shuffledTracks[0] as IMusic.IMusicItem,
			shuffledTracks as IMusic.IMusicItem[],
			true,
		)
	}

	return (
		<View style={[styles.container, style]} {...viewProps}>
			{/* Play button */}
			<View style={styles.control}>
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
						style={[styles.button, styles.playButton, isEmpty && styles.buttonDisabled]}
						disabled={isEmpty}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playButton.play')}
						accessibilityState={{ disabled: isEmpty }}
					>
						<Ionicons name="play" size={22} color="#fff" />

						<Text style={[styles.buttonText, styles.playButtonText]}>
							{i18n.t('playButton.play')}
						</Text>
					</TouchableOpacity>
				)}
			</View>

			{/* Shuffle button */}
			{!isMultiSelectMode ? (
				<View style={styles.control}>
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
				<View style={styles.control}>
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
				<MenuView
					title={i18n.t('downloadQuality.batchTitle', { count: downloadable.length })}
					actions={getDownloadQualityActions()}
					onPressAction={({ nativeEvent: { event } }) => {
						const quality = getDownloadQuality(event)
						if (quality)
							void confirmPlaylistDownload(downloadable, quality, myTrackPlayer.downloadPlaylist)
					}}
				>
					<TouchableOpacity
						accessibilityRole="button"
						accessibilityLabel={i18n.t('cacheCenter.downloadAll')}
						style={[styles.button, { minHeight: 48, paddingHorizontal: 10 }]}
					>
						<Ionicons name="download-outline" size={23} color={colors.primary} />
					</TouchableOpacity>
				</MenuView>
			) : null}
			{showImportMenu && (
				<View style={styles.control}>
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
							accessibilityLabel={importLabel || i18n.t('playButton.import')}
						>
							<Ionicons name={'enter-outline'} size={24} color={colors.primary} />

							<Text style={styles.buttonText}>{importLabel || i18n.t('playButton.import')}</Text>
						</TouchableOpacity>
					)}
				</View>
			)}
			{!isMultiSelectMode && managementActions?.length ? (
				<MenuView
					title={i18n.t('playlistTools.title')}
					actions={managementActions}
					onPressAction={({ nativeEvent: { event } }) => onManagementAction?.(event)}
				>
					<TouchableOpacity
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playlistTools.title')}
						style={[styles.button, { minHeight: 48, paddingHorizontal: 12 }]}
					>
						<Ionicons name="options-outline" size={23} color={colors.primary} />
					</TouchableOpacity>
				</MenuView>
			) : null}
			{isMultiSelectMode && onSelectedAction ? (
				<MenuView
					title={i18n.t('playlistTools.organizeSelected')}
					actions={[
						{ id: 'add', title: i18n.t('playlistTools.addSelected'), image: 'text.badge.plus' },
						{ id: 'move', title: i18n.t('playlistTools.moveSelected'), image: 'folder' },
						{
							id: 'top',
							title: i18n.t('playlistTools.moveSelectedTop'),
							image: 'arrow.up.to.line',
						},
						{
							id: 'bottom',
							title: i18n.t('playlistTools.moveSelectedBottom'),
							image: 'arrow.down.to.line',
						},
					]}
					onPressAction={({ nativeEvent: { event } }) =>
						onSelectedAction(event as 'add' | 'move' | 'top' | 'bottom')
					}
				>
					<TouchableOpacity
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playlistTools.organizeSelected')}
						style={[styles.button, !hasSelection && styles.buttonDisabled]}
						disabled={!hasSelection}
					>
						<Ionicons name="folder-open-outline" size={23} color={colors.primary} />
					</TouchableOpacity>
				</MenuView>
			) : null}
		</View>
	)
}

const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		container: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' },
		control: { flexGrow: 1, flexBasis: 96, minWidth: 96 },
		button: {
			minHeight: 48,
			paddingVertical: 12,
			paddingHorizontal: 10,
			backgroundColor: colors.surfaceMuted,
			borderRadius: 22,
			borderCurve: 'continuous',
			flexDirection: 'row',
			justifyContent: 'center',
			alignItems: 'center',
			columnGap: 6,
		},
		buttonText: {
			...defaultStyles.text,
			color: colors.primary,
			fontWeight: '600',
			fontSize: 14,
			flexShrink: 1,
			textAlign: 'center',
		},
		buttonDisabled: {
			opacity: 0.45,
		},
		playButton: { backgroundColor: colors.primary },
		playButtonText: { color: '#fff' },
	})
