import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import musicSdk from '@/components/utils/musicSdk'
import { unknownTrackImageUri } from '@/constants/images'
import { screenPadding, ThemeColors } from '@/constants/tokens'
import type { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import type { Track } from '@/player/types'
import i18n from '@/utils/i18n'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

type RemotePlaylistTrack = {
	singer?: string
	name?: string
	albumName?: string
	albumId?: string | number
	interval?: string | number
	songId?: string | number
	albumMid?: string
	strMediaMid?: string
	songmid?: string
	img?: string
	_types?: IMusic.IQuality
}

type RemotePlaylistDetail = {
	list?: RemotePlaylistTrack[]
	total?: number
	info?: {
		name?: string
		img?: string
		desc?: string
		author?: string
		play_count?: string | number
	}
}

const parseDuration = (value: string | number | undefined) => {
	if (typeof value === 'number') return value
	if (!value) return 0

	const parts = value.split(':').map(Number)
	if (parts.some((part) => !Number.isFinite(part))) return 0
	return parts.reduce((total, part) => total * 60 + part, 0)
}

const mapPlaylistTrack = (item: RemotePlaylistTrack, index: number, playlistId: string): Track => ({
	id: String(item.songmid || item.songId || `${playlistId}-${index}`),
	platform: 'tx',
	title: item.name || i18n.t('find.unknownSong'),
	artist: item.singer || i18n.t('find.unknownArtist'),
	duration: parseDuration(item.interval),
	album: item.albumName || '',
	artwork: item.img || unknownTrackImageUri,
	url: 'Unknown',
	songmid: item.songmid,
	albummid: item.albumMid,
	albumid: item.albumId,
	strMediaMid: item.strMediaMid,
	qualities: item._types,
})

const PlaylistScreen = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const { name: playlistId, title: initialTitle } = useLocalSearchParams<{
		name: string
		title?: string
	}>()
	const [playlist, setPlaylist] = useState<Playlist | null>(null)
	const [tracks, setTracks] = useState<Track[]>([])
	const [playCount, setPlayCount] = useState<string | number | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [hasError, setHasError] = useState(false)
	const requestRef = useRef(0)
	const cancelPlaylistRequest = useCallback(() => {
		requestRef.current++
	}, [])

	const loadPlaylist = useCallback(async () => {
		const requestId = ++requestRef.current
		setIsLoading(true)
		setHasError(false)

		try {
			const result = (await musicSdk.tx.songList.getListDetail(playlistId)) as RemotePlaylistDetail
			if (requestId !== requestRef.current) return
			if (!result?.info) throw new Error('Playlist detail is missing')

			const nextTracks = (result.list ?? []).map((item, index) =>
				mapPlaylistTrack(item, index, playlistId),
			)
			const title = result.info.name || initialTitle || i18n.t('find.playlistDetails')
			const artwork = result.info.img || unknownTrackImageUri

			setTracks(nextTracks)
			setPlayCount(result.info.play_count ?? null)
			setPlaylist({
				id: playlistId,
				platform: 'tx',
				name: title,
				title,
				artist: result.info.author || '',
				description: result.info.desc || '',
				artwork,
				coverImg: artwork,
				artworkPreview: artwork,
				singerImg: '',
				period: '',
				tracks: nextTracks,
				songs: nextTracks as IMusic.IMusicItem[],
			})
		} catch (error) {
			if (requestId !== requestRef.current) return
			console.error('Failed to fetch playlist detail:', error)
			setHasError(true)
		} finally {
			if (requestId === requestRef.current) setIsLoading(false)
		}
	}, [initialTitle, playlistId])

	useEffect(() => {
		void loadPlaylist()
		return cancelPlaylistRequest
	}, [cancelPlaylistRequest, loadPlaylist])

	const pageTitle = playlist?.title || initialTitle || i18n.t('find.playlistDetails')
	const metadata = [
		i18n.t('find.playlistSongs', { songs: tracks.length }),
		playCount == null ? null : i18n.t('find.playlistPlays', { plays: playCount }),
	]
		.filter(Boolean)
		.join(' · ')

	return (
		<View style={styles.container}>
			<Stack.Screen options={{ title: pageTitle }} />
			{isLoading ? (
				<View style={styles.stateContainer}>
					<ActivityIndicator size="large" color={colors.loading} />
					<Text style={styles.stateTitle}>{i18n.t('find.loadingPlaylist')}</Text>
				</View>
			) : hasError ? (
				<View style={styles.stateContainer}>
					<MaterialCommunityIcons name="cloud-alert-outline" size={44} color={colors.textMuted} />
					<Text style={styles.stateTitle}>{i18n.t('find.playlistLoadFailed')}</Text>
					<Text style={styles.stateDescription}>{i18n.t('find.checkNetwork')}</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => void loadPlaylist()}
						style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
					>
						<Text style={styles.retryText}>{i18n.t('find.retry')}</Text>
					</Pressable>
				</View>
			) : playlist && tracks.length > 0 ? (
				<ScrollView
					contentInsetAdjustmentBehavior="automatic"
					contentContainerStyle={styles.scrollContent}
				>
					<PlaylistTracksList
						playlist={playlist}
						tracks={tracks}
						showMetadata
						metadata={metadata}
					/>
				</ScrollView>
			) : (
				<View style={styles.stateContainer}>
					<MaterialCommunityIcons
						name="playlist-music-outline"
						size={48}
						color={colors.textMuted}
					/>
					<Text style={styles.stateTitle}>{i18n.t('find.emptyPlaylist')}</Text>
					<Text style={styles.stateDescription}>{i18n.t('find.emptyPlaylistDescription')}</Text>
				</View>
			)}
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: colors.background,
		},
		scrollContent: {
			paddingHorizontal: screenPadding.horizontal,
			paddingBottom: 32,
		},
		stateContainer: {
			flex: 1,
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
		pressed: {
			opacity: 0.6,
		},
	})

export default PlaylistScreen
