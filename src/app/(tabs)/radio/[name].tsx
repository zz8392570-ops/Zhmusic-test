import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { unknownTrackImageUri } from '@/constants/images'
import { screenPadding } from '@/constants/tokens'
import { importPlaylistByLink } from '@/helpers/importPlaylist'
import { isLeaderboardSource } from '@/helpers/leaderboard'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import type { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from 'react-native'

const valueOf = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) ?? ''

const PublicPlaylistScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const params = useLocalSearchParams<{
		name: string
		source?: string
		title?: string
		artwork?: string
		author?: string
		playCount?: string
		description?: string
	}>()
	const id = valueOf(params.name)
	const sourceValue = valueOf(params.source)
	const source = isLeaderboardSource(sourceValue) ? sourceValue : null
	const [playlist, setPlaylist] = useState<IMusic.PlayList | null>(null)
	const [loading, setLoading] = useState(true)
	const [failed, setFailed] = useState(false)
	const requestRef = useRef(0)

	const loadPlaylist = useCallback(async () => {
		if (!source || !id) return
		const requestId = ++requestRef.current
		setLoading(true)
		setFailed(false)
		try {
			const result = await importPlaylistByLink(id, source)
			if (requestId === requestRef.current) setPlaylist(result)
		} catch (error) {
			console.error('Failed to fetch public playlist detail:', error)
			if (requestId === requestRef.current) setFailed(true)
		} finally {
			if (requestId === requestRef.current) setLoading(false)
		}
	}, [id, source])

	useEffect(() => {
		void loadPlaylist()
		return () => {
			requestRef.current += 1
		}
	}, [loadPlaylist])

	if (!source || !id) return <Redirect href="/(tabs)/radio" />

	if (loading && !playlist) {
		return (
			<View style={[defaultStyles.container, { justifyContent: 'center', alignItems: 'center' }]}>
				<ActivityIndicator size="large" color={colors.loading} />
			</View>
		)
	}

	if (failed && !playlist) {
		return (
			<View style={[defaultStyles.container, { justifyContent: 'center', alignItems: 'center' }]}>
				<Text style={{ color: colors.textMuted, fontSize: 16 }}>
					{i18n.t('publicPlaylists.detailFailed')}
				</Text>
				<Pressable onPress={() => void loadPlaylist()} style={{ padding: 14 }}>
					<Text style={{ color: colors.primary, fontWeight: '600' }}>{i18n.t('home.retry')}</Text>
				</Pressable>
			</View>
		)
	}

	const displayPlaylist: Playlist = {
		id: playlist?.id ?? `${source}__${id}`,
		name: playlist?.name || valueOf(params.title),
		title: playlist?.title || valueOf(params.title),
		artist: playlist?.artist || valueOf(params.author),
		artwork: playlist?.artwork || valueOf(params.artwork) || unknownTrackImageUri,
		coverImg: playlist?.artwork || valueOf(params.artwork) || unknownTrackImageUri,
		artworkPreview: playlist?.artwork || valueOf(params.artwork) || unknownTrackImageUri,
		singerImg: unknownTrackImageUri,
		period: '',
		description: valueOf(params.description),
		platform: source,
		tracks: playlist?.songs ?? [],
		songs: playlist?.songs ?? [],
	}

	const savePlaylist = () => {
		if (!playlist) return
		const result = myTrackPlayer.addPlayLists(playlist)
		Alert.alert(
			result === 'success'
				? i18n.t('publicPlaylists.importedTitle')
				: result === 'duplicate'
					? i18n.t('publicPlaylists.alreadyImportedTitle')
					: i18n.t('publicPlaylists.importFailedTitle'),
			result === 'success'
				? i18n.t('publicPlaylists.importedMessage')
				: result === 'duplicate'
					? i18n.t('publicPlaylists.alreadyImportedMessage')
					: i18n.t('publicPlaylists.importFailedMessage'),
		)
	}

	return (
		<View style={defaultStyles.container}>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
				refreshControl={
					<RefreshControl
						refreshing={loading}
						onRefresh={loadPlaylist}
						tintColor={colors.primary}
					/>
				}
			>
				{failed ? (
					<Pressable onPress={() => void loadPlaylist()}>
						<Text style={{ color: colors.primary, textAlign: 'center', paddingVertical: 10 }}>
							{i18n.t('home.refreshFailed')}
						</Text>
					</Pressable>
				) : null}
				<PlaylistTracksList
					playlist={displayPlaylist}
					tracks={displayPlaylist.tracks}
					showMetadata
					metadata={[
						valueOf(params.playCount)
							? `${valueOf(params.playCount)} ${i18n.t('publicPlaylists.playsUnit')}`
							: '',
						i18n.t('charts.trackCount', { count: displayPlaylist.tracks.length }),
					]
						.filter(Boolean)
						.join(' · ')}
					showImportMenu
					onImportTrack={savePlaylist}
					importLabel={i18n.t('publicPlaylists.saveToMy')}
				/>
			</ScrollView>
		</View>
	)
}

export default PublicPlaylistScreen
