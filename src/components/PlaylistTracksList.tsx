import { unknownTrackImageUri } from '@/constants/images'
import { fontSize, ThemeColors } from '@/constants/tokens'
import { generateTracksListId } from '@/helpers/miscellaneous'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import type { Track } from '@/player/types'
import { QueueControls } from './QueueControls'
import { TracksList } from './TracksList'

type PlaylistTracksListProps = {
	playlist: Playlist
	tracks: Track[]
	allowDelete?: boolean
	onDeleteTrack?: (trackId: string) => void
	showImportMenu?: boolean
	onImportTrack?: () => void
	isMultiSelectMode?: boolean
	selectedTracks?: Set<string>
	toggleMultiSelectMode?: () => void
	onToggleSelection?: (trackId: string) => void
	onSelectAll?: () => void
	deleteSelectedTracks?: () => void
	exportSelectedTracks?: () => void
	showMetadata?: boolean
	metadata?: string
}

export const PlaylistTracksList = ({
	playlist,
	tracks,
	allowDelete = false,
	onDeleteTrack,
	showImportMenu = false,
	onImportTrack,
	isMultiSelectMode = false,
	selectedTracks = new Set(),
	onToggleSelection,
	toggleMultiSelectMode,
	onSelectAll,
	deleteSelectedTracks,
	exportSelectedTracks,
	showMetadata = false,
	metadata,
}: PlaylistTracksListProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	// const filteredPlaylistTracks = useMemo(() => {
	// 	return playlist.tracks.filter(trackTitleFilter(search))
	// }, [playlist.tracks, search])

	return (
		<TracksList
			id={generateTracksListId(playlist.id || playlist.title)}
			scrollEnabled={false}
			hideQueueControls={true}
			ListHeaderComponentStyle={styles.playlistHeaderContainer}
			ListHeaderComponent={
				<View>
					<View style={styles.artworkImageContainer}>
						<Image
							contentFit="cover"
							cachePolicy="memory-disk"
							priority="high"
							recyclingKey={
								(playlist.coverImg || playlist.artwork || unknownTrackImageUri) ?? 'missing-artwork'
							}
							source={{
								uri: playlist.coverImg || playlist.artwork || unknownTrackImageUri,
							}}
							style={styles.artworkImage}
						/>
					</View>

					<Text numberOfLines={1} style={styles.playlistNameText}>
						{playlist.title}
					</Text>
					{showMetadata && playlist.artist ? (
						<Text numberOfLines={1} style={styles.playlistArtistText}>
							{playlist.artist}
						</Text>
					) : null}
					{showMetadata && metadata ? (
						<Text numberOfLines={1} style={styles.playlistStatsText}>
							{metadata}
						</Text>
					) : null}
					{showMetadata && playlist.description ? (
						<Text numberOfLines={3} style={styles.playlistDescriptionText}>
							{playlist.description}
						</Text>
					) : null}

					<QueueControls
						style={{ paddingTop: showMetadata ? 18 : 24 }}
						tracks={tracks}
						showImportMenu={showImportMenu}
						onImportTrack={onImportTrack}
						isMultiSelectMode={isMultiSelectMode}
						onSelectAll={onSelectAll}
						isAllSelected={selectedTracks.size === tracks.length}
						deleteSelectedTracks={deleteSelectedTracks}
						exportSelectedTracks={exportSelectedTracks}
					/>
				</View>
			}
			tracks={tracks}
			allowDelete={allowDelete}
			onDeleteTrack={onDeleteTrack}
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
			flex: 1,
			marginBottom: 32,
		},
		artworkImageContainer: {
			flexDirection: 'row',
			justifyContent: 'center',
		},
		artworkImage: {
			width: '85%',
			aspectRatio: 1,
			borderRadius: 12,
		},
		playlistNameText: {
			...defaultStyles.text,
			marginTop: 22,
			textAlign: 'center',
			fontSize: fontSize.lg,
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
	})
