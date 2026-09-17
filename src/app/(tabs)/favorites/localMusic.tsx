import localImage from '@/assets/local.png'
import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors, screenPadding } from '@/constants/tokens'
import { logError, logInfo } from '@/helpers/logger'
import { resolveLocalFile } from '@/helpers/localFile'
import myTrackPlayer, { importedLocalMusicStore } from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import MusicInfo from '@/utils/musicInfo'
import { shareLocalFiles } from '../../../../modules/cymusic-native/sharing'
import * as DocumentPicker from 'expo-document-picker'
import React, { useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Image,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import type { Track } from '@/player/types'

type ImportProgress = {
	current: number
	total: number
}

const LocalMusicScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors), [colors])
	const localTracksValue = importedLocalMusicStore.useValue()
	const localTracks = useMemo(() => localTracksValue || [], [localTracksValue])
	const [isLoading, setIsLoading] = useState(false)
	const [loadingOperation, setLoadingOperation] = useState<'import' | 'export' | null>(null)
	const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
	const playListItem = {
		name: 'Local',
		id: 'local',
		tracks: [],
		title: i18n.t('appTab.localOrCachedSongs'),
		coverImg: Image.resolveAssetSource(localImage).uri,
		description: i18n.t('appTab.localOrCachedSongs'),
	}
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
	const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())
	const [filter, setFilter] = useState<'all' | 'imported' | 'cached' | 'saved' | 'automatic'>('all')
	const [sort, setSort] = useState<'recent' | 'title' | 'artist'>('recent')
	const visibleTracks = useMemo(() => {
		const filtered = localTracks.filter((track) => {
			const cached = String(track.url || '').includes('/musicCache/')
			if (filter === 'saved') return cached && track.cacheKind !== 'automatic'
			if (filter === 'automatic') return cached && track.cacheKind === 'automatic'
			return filter === 'all' || (filter === 'cached' ? cached : !cached)
		})
		if (sort === 'recent') return filtered
		return [...filtered].sort((a, b) =>
			String(a[sort] || '').localeCompare(String(b[sort] || ''), i18n.locale),
		)
	}, [filter, localTracks, sort])

	const toggleMultiSelectMode = () => {
		setIsMultiSelectMode(!isMultiSelectMode)
		setSelectedTracks(new Set())
	}
	const deleteSelectedTracks = () => {
		if (selectedTracks.size === 0) return

		Alert.alert(
			i18n.t('localMusic.deleteTitle'),
			i18n.t('localMusic.deleteSelectedMessage', { count: selectedTracks.size }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('localMusic.delete'),
					style: 'destructive',
					onPress: async () => {
						await Promise.all(
							[...selectedTracks].map((trackId) => myTrackPlayer.deleteImportedLocalMusic(trackId)),
						)
						setSelectedTracks(new Set())
						setIsMultiSelectMode(false)
					},
				},
			],
		)
	}
	const toggleSelectAll = () => {
		if (!localTracks || !Array.isArray(localTracks)) {
			// 如果 localTracks 未定义或不是数组，直接返回
			return
		}
		if (selectedTracks.size === visibleTracks.length) {
			// 如果当前所有曲目都被选中，则取消全选
			setSelectedTracks(new Set())
		} else {
			// 否则，选择所有曲目
			const allTrackIds = new Set(visibleTracks.map((track) => track.id))
			setSelectedTracks(allTrackIds)
		}
	}
	const toggleTrackSelection = (trackId: string) => {
		setSelectedTracks((prevSelected) => {
			const newSelected = new Set(prevSelected)
			if (newSelected.has(trackId)) {
				newSelected.delete(trackId)
			} else {
				newSelected.add(trackId)
			}
			return newSelected
		})
	}
	const exportSelectedTracks = async () => {
		if (selectedTracks.size === 0) {
			Alert.alert(i18n.t('localMusic.notice'), i18n.t('localMusic.selectBeforeExport'))
			setIsMultiSelectMode(false)
			return
		}
		try {
			setIsLoading(true)
			setLoadingOperation('export')
			const selected = localTracks.filter((track) => selectedTracks.has(track.id))
			const resolvedFiles = await Promise.all(
				selected.map((track) => resolveLocalFile(track.url, { requireOwnedMedia: true })),
			)
			const filePaths = resolvedFiles.flatMap((result) =>
				result.status === 'resolved' ? [result.filePath] : [],
			)
			if (filePaths.length !== selected.length) {
				Alert.alert(
					i18n.t('localMusic.exportUnavailableTitle'),
					i18n.t('localMusic.exportUnavailableMessage', {
						count: selected.length - filePaths.length,
					}),
				)
				return
			}
			const completed = await shareLocalFiles(filePaths)
			if (completed) {
				setSelectedTracks(new Set())
				setIsMultiSelectMode(false)
			}
		} catch (error) {
			logError('导出本地音乐时出错:', error)
			Alert.alert(i18n.t('localMusic.exportFailed'))
		} finally {
			setIsLoading(false)
			setLoadingOperation(null)
		}
	}
	const importLocalMusic = async () => {
		try {
			setIsLoading(true)
			setLoadingOperation('import')
			const result = await DocumentPicker.getDocumentAsync({
				type: 'audio/*',
				multiple: true,
			})

			if (result.canceled) {
				logInfo('用户取消了文件选择')
				setIsLoading(false)
				return
			}
			console.log('result.assets:', result.assets)
			if (result.assets.length > 50) {
				Alert.alert(i18n.t('localMusic.notice'), i18n.t('localMusic.importLimit'))
				return
			}
			const filesToImport = result.assets.filter(
				(file) => !myTrackPlayer.isExistImportedLocalMusic(file.name),
			)
			if (filesToImport.length === 0) {
				Alert.alert(i18n.t('localMusic.nothingNewTitle'), i18n.t('localMusic.nothingNewMessage'))
				return
			}

			const newTracks: IMusic.IMusicItem[] = []
			for (const [index, file] of filesToImport.entries()) {
				setImportProgress({ current: index + 1, total: filesToImport.length })
				let metadata: Awaited<ReturnType<typeof MusicInfo.getMusicInfoAsync>> = null
				try {
					metadata = await MusicInfo.getMusicInfoAsync(file.uri, {
						title: true,
						artist: true,
						album: true,
						genre: true,
						picture: true,
					})
				} catch (error) {
					logError(`读取本地音乐元数据失败: ${file.name}`, error)
				}

				const embeddedArtwork = metadata?.picture?.pictureData
				const fallbackTitle = file.name.replace(/\.[^.]+$/, '')
				const extension = file.name.split('.').pop()?.toLocaleLowerCase()
				newTracks.push({
					id: file.uri,
					title: metadata?.title || fallbackTitle || i18n.t('find.unknownSong'),
					artist: metadata?.artist || i18n.t('find.unknownArtist'),
					album: metadata?.album || i18n.t('localMusic.unknownAlbum'),
					artwork:
						embeddedArtwork && embeddedArtwork.length <= 500_000
							? embeddedArtwork
							: unknownTrackImageUri,
					url: file.uri,
					platform: 'local',
					duration: 0,
					genre: file.name,
					contentType: file.mimeType,
					format: extension,
					fileSize: file.size,
				})
			}

			const resultStatus = await myTrackPlayer.addImportedLocalMusic(newTracks, true, false)
			if (resultStatus === 'success') {
				Alert.alert(
					i18n.t('localMusic.importSuccessTitle'),
					i18n.t('localMusic.importSuccessMessage', { count: newTracks.length }),
				)
			} else {
				Alert.alert(i18n.t('localMusic.importFailed'))
			}
		} catch (err) {
			logError('导入本地音乐时出错:', err)
			Alert.alert(i18n.t('localMusic.importFailed'))
		} finally {
			setImportProgress(null)
			setIsLoading(false)
			setLoadingOperation(null)
		}
	}

	function deleteLocalMusic(trackId: string): void {
		const track = localTracks.find((item) => item.id === trackId)
		Alert.alert(
			i18n.t('localMusic.deleteTitle'),
			i18n.t('localMusic.deleteOneMessage', { name: track?.title || i18n.t('find.unknownSong') }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('localMusic.delete'),
					style: 'destructive',
					onPress: () => void myTrackPlayer.deleteImportedLocalMusic(trackId),
				},
			],
		)
	}

	return (
		<View style={defaultStyles.container}>
			{isLoading && (
				<View style={styles.loadingOverlay}>
					<View
						style={styles.loadingCard}
						accessible
						accessibilityRole="progressbar"
						accessibilityLiveRegion="polite"
						accessibilityValue={
							importProgress
								? {
										min: 0,
										now: importProgress.current,
										max: importProgress.total,
										text: i18n.t('localMusic.importing', importProgress),
									}
								: {
										text: i18n.t(
											loadingOperation === 'export'
												? 'localMusic.preparingExport'
												: 'localMusic.preparingImport',
										),
									}
						}
					>
						<ActivityIndicator size="large" color={colors.loading} />
						<Text style={styles.loadingText}>
							{importProgress
								? i18n.t('localMusic.importing', importProgress)
								: i18n.t(
										loadingOperation === 'export'
											? 'localMusic.preparingExport'
											: 'localMusic.preparingImport',
									)}
						</Text>
						{importProgress ? (
							<View style={styles.progressTrack}>
								<View
									style={[
										styles.progressFill,
										{
											width:
												`${(importProgress.current / importProgress.total) * 100}%` as `${number}%`,
										},
									]}
								/>
							</View>
						) : null}
					</View>
				</View>
			)}
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<View style={styles.libraryControls}>
					{(['all', 'imported', 'saved', 'automatic'] as const).map((item) => (
						<Pressable
							key={item}
							accessibilityRole="button"
							accessibilityState={{ selected: filter === item }}
							onPress={() => {
								setFilter(item)
								setSelectedTracks(new Set())
							}}
							style={[styles.chip, filter === item && styles.activeChip]}
						>
							<Text style={[styles.chipText, filter === item && styles.activeChipText]}>
								{i18n.t(`localMusic.filters.${item}`)}
							</Text>
						</Pressable>
					))}
					<View style={{ flex: 1 }} />
					{(['recent', 'title', 'artist'] as const).map((item) => (
						<Pressable
							key={item}
							accessibilityRole="button"
							accessibilityState={{ selected: sort === item }}
							onPress={() => setSort(item)}
							style={[styles.chip, sort === item && styles.activeChip]}
						>
							<Text style={[styles.chipText, sort === item && styles.activeChipText]}>
								{i18n.t(`library.sort.${item}`)}
							</Text>
						</Pressable>
					))}
				</View>
				<PlaylistTracksList
					playlist={playListItem as Playlist}
					tracks={visibleTracks as Track[]}
					showImportMenu={true}
					onImportTrack={importLocalMusic}
					allowDelete={true}
					onDeleteTrack={deleteLocalMusic}
					isMultiSelectMode={isMultiSelectMode}
					selectedTracks={selectedTracks}
					onToggleSelection={toggleTrackSelection}
					toggleMultiSelectMode={toggleMultiSelectMode}
					onSelectAll={toggleSelectAll}
					deleteSelectedTracks={deleteSelectedTracks}
					exportSelectedTracks={exportSelectedTracks}
				/>
			</ScrollView>
		</View>
	)
}
const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		loadingOverlay: {
			position: 'absolute',
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.overlay,
			zIndex: 1000,
		},
		loadingCard: {
			alignItems: 'center',
			width: 220,
			paddingHorizontal: 24,
			paddingVertical: 22,
			borderRadius: 16,
			backgroundColor: colors.surfaceElevated,
		},
		loadingText: {
			marginTop: 12,
			fontSize: 15,
			color: colors.text,
		},
		progressTrack: {
			width: '100%',
			height: 4,
			marginTop: 14,
			borderRadius: 2,
			overflow: 'hidden',
			backgroundColor: colors.maximumTrackTintColor,
		},
		progressFill: {
			height: '100%',
			borderRadius: 2,
			backgroundColor: colors.loading,
		},
		libraryControls: {
			alignItems: 'center',
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: 6,
			marginBottom: 8,
			paddingTop: 8,
		},
		chip: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 13,
			paddingHorizontal: 8,
			paddingVertical: 6,
		},
		activeChip: { backgroundColor: colors.primary },
		chipText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
		activeChipText: { color: '#fff' },
		header: {
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
			padding: 10,
		},
	})
export default LocalMusicScreen
