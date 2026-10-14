import { unknownTrackImageUri } from '@/constants/images'
import { fontSize, ThemeColors } from '@/constants/tokens'
import { generateTracksListId } from '@/helpers/miscellaneous'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import type { Track } from '@/player/types'
import type { MenuAction } from '@react-native-menu/menu'
import { QueueControls } from './QueueControls'
import { TracksList, type TracksListScrollProps } from './TracksList'
import { getLibraryTrackKey } from '@/helpers/libraryEdits'

type PlaylistTracksListProps = TracksListScrollProps & {
	playlist: Playlist
	tracks: Track[]
	allowDelete?: boolean
	onDeleteTrack?: (track: Track) => void
	showImportMenu?: boolean
	onImportTrack?: () => void
	importLabel?: string
	isMultiSelectMode?: boolean
	selectedTracks?: Set<string>
	toggleMultiSelectMode?: () => void
	onToggleSelection?: (trackId: string) => void
	onSelectAll?: () => void
	deleteSelectedTracks?: () => void
	exportSelectedTracks?: () => void
	managementActions?: MenuAction[]
	onManagementAction?: (actionId: string) => void
	onSelectedAction?: (actionId: 'add' | 'move' | 'top' | 'bottom') => void
	onReplaceSource?: (track: Track) => void
	showMetadata?: boolean
	metadata?: string
	compactHeader?: boolean
	headerContent?: ReactNode
	footerContent?: ReactNode
}

export const PlaylistTracksList = ({
	playlist,
	tracks,
	allowDelete = false,
	onDeleteTrack,
	showImportMenu = false,
	onImportTrack,
	importLabel,
	isMultiSelectMode = false,
	selectedTracks = new Set(),
	onToggleSelection,
	toggleMultiSelectMode,
	onSelectAll,
	deleteSelectedTracks,
	exportSelectedTracks,
	managementActions,
	onManagementAction,
	onSelectedAction,
	onReplaceSource,
	showMetadata = false,
	metadata,
	compactHeader = false,
	headerContent,
	footerContent,
	...listProps
}: PlaylistTracksListProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	const artworkUri = playlist.coverImg || playlist.artwork || unknownTrackImageUri
	const [failedArtworkUri, setFailedArtworkUri] = useState<string | null>(null)
	const displayedArtworkUri = failedArtworkUri === artworkUri ? unknownTrackImageUri : artworkUri

	return (
		<TracksList
			{...listProps}
			id={generateTracksListId(playlist.id || playlist.title)}
			hideQueueControls={true}
			ListHeaderComponentStyle={styles.playlistHeaderContainer}
			ListHeaderComponent={
				<View>
					{headerContent}
					<View style={compactHeader && styles.compactHeader}>
						<View style={styles.artworkImageContainer}>
							<Image
								contentFit="cover"
								cachePolicy="memory-disk"
								priority="high"
								recyclingKey={displayedArtworkUri}
								source={{ uri: displayedArtworkUri }}
								onError={() => setFailedArtworkUri(artworkUri)}
								style={[styles.artworkImage, compactHeader && styles.compactArtwork]}
							/>
						</View>
						<View style={compactHeader && styles.compactInfo}>
							<Text style={[styles.playlistNameText, compactHeader && styles.compactName]}>
								{playlist.title || playlist.name}
							</Text>
							{showMetadata && playlist.artist ? (
								<Text style={[styles.playlistArtistText, compactHeader && styles.compactText]}>
									{playlist.artist}
								</Text>
							) : null}
							{(showMetadata && metadata) || compactHeader ? (
								<Text style={[styles.playlistStatsText, compactHeader && styles.compactText]}>
									{metadata || i18n.t('charts.trackCount', { count: tracks.length })}
								</Text>
							) : null}
							{showMetadata && playlist.description ? (
								<Text
									numberOfLines={3}
									style={[styles.playlistDescriptionText, compactHeader && styles.compactText]}
								>
									{playlist.description}
								</Text>
							) : null}
						</View>
					</View>

					<QueueControls
						style={{ paddingTop: compactHeader ? 14 : 18 }}
						tracks={tracks}
						showImportMenu={showImportMenu}
						onImportTrack={onImportTrack}
						importLabel={importLabel}
						isMultiSelectMode={isMultiSelectMode}
						onSelectAll={onSelectAll}
						isAllSelected={
							tracks.length > 0 &&
							tracks.every((track) => selectedTracks.has(getLibraryTrackKey(track)))
						}
						hasSelection={tracks.some((track) => selectedTracks.has(getLibraryTrackKey(track)))}
						deleteSelectedTracks={deleteSelectedTracks}
						exportSelectedTracks={exportSelectedTracks}
						managementActions={managementActions}
						onManagementAction={onManagementAction}
						onSelectedAction={onSelectedAction}
					/>
				</View>
			}
			ListFooterComponent={footerContent}
			tracks={tracks}
			allowDelete={allowDelete}
			onDeleteTrack={onDeleteTrack}
			onReplaceSource={onReplaceSource}
			isMultiSelectMode={isMultiSelectMode}
			selectedTracks={selectedTracks}
			onToggleSelection={onToggleSelection}
			toggleMultiSelectMode={toggleMultiSelectMode}
		/>
	)
}

const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		playlistHeaderContainer: {
			marginBottom: 18,
		},
		artworkImageContainer: {
			flexDirection: 'row',
			justifyContent: 'center',
		},
		artworkImage: {
			width: '62%',
			maxWidth: 240,
			aspectRatio: 1,
			borderRadius: 14,
			backgroundColor: colors.surfaceMuted,
		},
		playlistNameText: {
			...defaultStyles.text,
			marginTop: 16,
			textAlign: 'center',
			fontSize: fontSize.lg,
			lineHeight: 32,
			fontWeight: '800',
		},
		playlistArtistText: {
			marginTop: 7,
			color: colors.textMuted,
			fontSize: 14,
			textAlign: 'center',
		},
		playlistStatsText: {
			marginTop: 5,
			color: colors.textMuted,
			fontSize: 13,
			textAlign: 'center',
		},
		playlistDescriptionText: {
			marginTop: 12,
			color: colors.textMuted,
			fontSize: 13,
			lineHeight: 19,
			textAlign: 'center',
		},
		compactHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
		compactArtwork: { width: 68, maxWidth: 68 },
		compactInfo: { flex: 1, minWidth: 0 },
		compactName: { marginTop: 0, textAlign: 'left', fontSize: 22, lineHeight: 28 },
		compactText: { textAlign: 'left' },
	})
