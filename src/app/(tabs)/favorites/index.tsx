import localImage from '@/assets/local.png'
import { PlaylistsList } from '@/components/PlaylistsList'
import TracksListItem from '@/components/TracksListItem'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { searchPersonalLibrary } from '@/helpers/personalLibrarySearch'
import { useThemeColors } from '@/hooks/useAppTheme'
import { isSameMediaItem } from '@/utils/mediaItem'
import { screenPadding } from '@/constants/tokens'
import {
	importedLocalMusicStore,
	playListsStore,
	recentlyPlayedStore,
} from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import DiscoveryHeading from '@/components/DiscoveryHeading'
import GlobalButton from '@/components/GlobalButton'
import AddPlayListButton from '@/components/AddPlayListButton'
import { useFavorites } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { sortLibraryPlaylists } from '@/helpers/playlistOrganizer'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { useIsPlaying } from '@rntp/player'
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import PersistStatus from '@/store/PersistStatus'
import { getSmartPlaylistTracks, type SmartPlaylistKind } from '@/helpers/listeningStats'
import { Ionicons } from '@expo/vector-icons'

const FavoritesScreen = () => {
	const defaultStyles = useDefaultStyles()
	const colors = useThemeColors()
	const playing = useIsPlaying()
	const currentTrack = myTrackPlayer.useCurrentMusic()
	const [search, setSearch] = useState('')

	const storedPlayLists = playListsStore.useValue()
	const localTracks = importedLocalMusicStore.useValue()
	const recentlyPlayed = recentlyPlayedStore.useValue()
	const { favorites } = useFavorites()
	const listeningStats = PersistStatus.useValue('music.listeningStats', [])
	const smartPlaylists = useMemo(() => {
		const records = listeningStats ?? []
		return (['frequent', 'mostPlayed', 'recentlyAdded', 'forgotten'] as SmartPlaylistKind[]).map(
			(kind) => {
				const tracks = getSmartPlaylistTracks(kind, records)
				return {
					name: kind,
					id: `smart:${kind}`,
					tracks,
					title: i18n.t(`listeningStats.smart.${kind}`),
					coverImg: tracks[0]?.artwork || Image.resolveAssetSource(localImage).uri,
					description: i18n.t(`listeningStats.smartDescriptions.${kind}`),
				}
			},
		)
	}, [listeningStats])
	const playLists = useMemo(
		() =>
			[
				...smartPlaylists,
				{
					name: 'Recent',
					id: 'recent',
					tracks: recentlyPlayed,
					title: i18n.t('appTab.recentlyPlayed'),
					coverImg: recentlyPlayed[0]?.artwork || Image.resolveAssetSource(localImage).uri,
					description: i18n.t('appTab.recentlyPlayed'),
				},
				{
					name: 'Favorites',
					id: 'favorites',
					tracks: favorites,
					title: i18n.t('appTab.favoritesSongs'),
					coverImg: 'https://y.qq.com/mediastyle/global/img/cover_like.png?max_age=2592000',
					description: i18n.t('appTab.favoritesSongs'),
				},
				{
					name: 'Local',
					id: 'local',
					tracks: localTracks ?? [],
					title: i18n.t('appTab.localOrCachedSongs'),
					coverImg: Image.resolveAssetSource(localImage).uri,
					description: i18n.t('appTab.localOrCachedSongs'),
				},
				...sortLibraryPlaylists((storedPlayLists ?? []) as Playlist[]),
			] as Playlist[],
		[storedPlayLists, favorites, localTracks, recentlyPlayed, smartPlaylists],
	)

	const results = useMemo(() => searchPersonalLibrary(playLists, search), [playLists, search])
	const filteredPlayLists = results.playlists as Playlist[]
	const corePlaylists = useMemo(
		() => ({
			favorites: playLists.find((item) => item.id === 'favorites')!,
			recent: playLists.find((item) => item.id === 'recent')!,
			local: playLists.find((item) => item.id === 'local')!,
			mostPlayed: playLists.find((item) => item.id === 'smart:mostPlayed')!,
		}),
		[playLists],
	)
	const handlePlaylistPress = (playlist: Playlist) => {
		if (playlist.id.startsWith('smart:')) {
			router.push({
				pathname: '/(tabs)/favorites/smartPlaylist',
				params: { kind: playlist.id.slice(6) },
			})
		} else if (playlist.id === 'favorites') {
			router.push(`/(tabs)/favorites/favoriteMusic`)
		} else if (playlist.id === 'recent') {
			router.push(`/(tabs)/favorites/recentMusic`)
		} else if (playlist.id === 'local') {
			router.push(`/(tabs)/favorites/localMusic`)
		} else {
			router.push(`/(tabs)/favorites/${playlist.id}`)
		}
	}
	const heading = (
		<>
			<DiscoveryHeading
				title={i18n.t('appTab.favorites')}
				action={
					<View style={{ flexDirection: 'row', alignItems: 'center' }}>
						<AddPlayListButton />
						<GlobalButton />
					</View>
				}
			/>
			<View
				style={{
					marginHorizontal: screenPadding.horizontal,
					marginBottom: 8,
					minHeight: 38,
					borderRadius: 12,
					backgroundColor: colors.surfaceMuted,
					paddingHorizontal: 12,
					flexDirection: 'row',
					alignItems: 'center',
					gap: 8,
				}}
			>
				<Ionicons name="search-outline" size={19} color={colors.textMuted} />
				<TextInput
					value={search}
					onChangeText={setSearch}
					placeholder={i18n.t('find.inFavorites')}
					placeholderTextColor={colors.textMuted}
					style={{ flex: 1, color: colors.text, minHeight: 38, paddingVertical: 8, fontSize: 14 }}
				/>
				{search ? (
					<Pressable onPress={() => setSearch('')} accessibilityLabel={i18n.t('find.cancel')}>
						<Ionicons name="close-circle" size={18} color={colors.textMuted} />
					</Pressable>
				) : null}
			</View>
		</>
	)
	if (search.trim()) {
		return (
			<View style={defaultStyles.container}>
				{heading}
				<ScrollView
					contentInsetAdjustmentBehavior="never"
					style={{ paddingHorizontal: screenPadding.horizontal }}
				>
					{results.tracks.length ? (
						<View style={{ paddingTop: 16, gap: 14 }}>
							<Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
								{i18n.t('library.songResults', { count: results.tracks.length })}
							</Text>
							{results.tracks.map(({ track, collections }) => (
								<View key={JSON.stringify([track.platform, track.id])}>
									<TracksListItem
										track={track}
										onTrackSelect={(selectedTrack) =>
											void myTrackPlayer.play(selectedTrack as IMusic.IMusicItem)
										}
										isActiveTrack={isSameMediaItem(track as IMusic.IMusicItem, currentTrack)}
										isPlaying={playing}
									/>
									<Text
										style={{ color: colors.textMuted, fontSize: 12, marginLeft: 64, marginTop: 5 }}
										numberOfLines={2}
									>
										{collections.map((item) => item.title).join(' · ')}
									</Text>
								</View>
							))}
						</View>
					) : null}
					<Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 20 }}>
						{i18n.t('library.playlistResults', { count: filteredPlayLists.length })}
					</Text>
					<PlaylistsList
						ListEmptyComponent={
							<Text style={{ color: colors.textMuted, paddingVertical: 20 }}>
								{i18n.t('library.searchNoResults')}
							</Text>
						}
						scrollEnabled={false}
						playlists={filteredPlayLists}
						onPlaylistPress={handlePlaylistPress}
					/>
				</ScrollView>
			</View>
		)
	}

	const shortcuts = [
		{ playlist: corePlaylists.favorites, icon: 'heart' as const },
		{ playlist: corePlaylists.recent, icon: 'time' as const },
		{ playlist: corePlaylists.local, icon: 'download' as const },
		{ playlist: corePlaylists.mostPlayed, icon: 'sparkles' as const },
	]
	const remainingSmartPlaylists = smartPlaylists.filter((item) => item.id !== 'smart:mostPlayed')

	return (
		<View style={defaultStyles.container}>
			{heading}
			<ScrollView
				contentInsetAdjustmentBehavior="never"
				contentContainerStyle={{ paddingHorizontal: screenPadding.horizontal, paddingBottom: 150 }}
			>
				<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
					{shortcuts.map(({ playlist, icon }) => (
						<Pressable
							key={playlist.id}
							onPress={() => handlePlaylistPress(playlist)}
							style={({ pressed }) => ({
								width: '48%',
								flexGrow: 1,
								minHeight: 90,
								padding: 13,
								borderRadius: 18,
								backgroundColor: colors.surfaceElevated,
								opacity: pressed ? 0.7 : 1,
							})}
						>
							<View
								style={{
									width: 30,
									height: 30,
									borderRadius: 12,
									alignItems: 'center',
									justifyContent: 'center',
									backgroundColor: colors.overlaySoft,
								}}
							>
								<Ionicons name={icon} size={18} color={colors.primary} />
							</View>
							<Text
								numberOfLines={1}
								style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 8 }}
							>
								{playlist.title}
							</Text>
							<Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
								{i18n.t('library.songCount', { count: playlist.tracks.length })}
							</Text>
						</Pressable>
					))}
				</View>

				<Text style={{ color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 18 }}>
					{i18n.t('library.smartPlaylists')}
				</Text>
				<PlaylistsList
					scrollEnabled={false}
					contentContainerStyle={{ paddingTop: 10, paddingBottom: 10 }}
					playlists={remainingSmartPlaylists as Playlist[]}
					onPlaylistPress={handlePlaylistPress}
				/>

				<Text style={{ color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 18 }}>
					{i18n.t('library.myPlaylists')}
				</Text>
				<PlaylistsList
					scrollEnabled={false}
					contentContainerStyle={{ paddingTop: 10, paddingBottom: 10 }}
					playlists={sortLibraryPlaylists((storedPlayLists ?? []) as Playlist[])}
					onPlaylistPress={handlePlaylistPress}
				/>
			</ScrollView>
		</View>
	)
}

export default FavoritesScreen
