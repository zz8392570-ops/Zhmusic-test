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
	const [showSearch, setShowSearch] = useState(false)

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
		if (playlist.id === 'smartCollections') {
			router.push('/(tabs)/favorites/smartPlaylists')
		} else if (playlist.id.startsWith('smart:')) {
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
			<DiscoveryHeading large title={i18n.t('appTab.favorites')} action={<GlobalButton />} />
			{showSearch ? (
				<View
					style={{
						marginHorizontal: 18,
						marginTop: 8,
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
						autoFocus
						value={search}
						onChangeText={setSearch}
						placeholder={i18n.t('find.inFavorites')}
						placeholderTextColor={colors.textMuted}
						style={{ flex: 1, color: colors.text, minHeight: 38, paddingVertical: 8, fontSize: 14 }}
					/>
					<Pressable
						onPress={() => {
							setSearch('')
							setShowSearch(false)
						}}
						accessibilityLabel={i18n.t('find.cancel')}
					>
						<Ionicons name="close-circle" size={18} color={colors.textMuted} />
					</Pressable>
				</View>
			) : null}
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
		{
			playlist: corePlaylists.favorites,
			title: i18n.t('appTab.favoritesSongs'),
			icon: 'heart' as const,
			tint: '#fc3c44',
		},
		{
			playlist: corePlaylists.local,
			title: i18n.t('library.localMusic'),
			icon: 'folder' as const,
			tint: '#9b6cff',
		},
		{
			playlist: corePlaylists.recent,
			title: i18n.t('appTab.recentlyPlayed'),
			icon: 'time' as const,
			tint: '#50da8b',
		},
		{
			playlist: {
				id: 'smartCollections',
				title: i18n.t('library.smartPlaylists'),
				tracks: [],
			} as unknown as Playlist,
			title: i18n.t('library.smartPlaylists'),
			icon: 'radio' as const,
			tint: '#fc6d72',
		},
	]
	return (
		<View style={defaultStyles.container}>
			{heading}
			<ScrollView
				contentInsetAdjustmentBehavior="never"
				contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 150 }}
			>
				<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
					{shortcuts.map(({ playlist, title, icon, tint }) => (
						<Pressable
							key={playlist.id}
							onPress={() => handlePlaylistPress(playlist)}
							style={({ pressed }) => ({
								width: '48%',
								flexGrow: 1,
								minHeight: 82,
								paddingHorizontal: 12,
								paddingVertical: 16,
								borderRadius: 16,
								backgroundColor: colors.surfaceElevated,
								flexDirection: 'row',
								alignItems: 'center',
								gap: 9,
								opacity: pressed ? 0.7 : 1,
							})}
						>
							<View
								style={{
									width: 42,
									height: 46,
									borderRadius: 13,
									backgroundColor: tint + '20',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<Ionicons name={icon} size={27} color={tint} />
							</View>
							<View style={{ flex: 1, minWidth: 0 }}>
								<Text
									numberOfLines={1}
									adjustsFontSizeToFit
									minimumFontScale={0.85}
									style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}
								>
									{title}
								</Text>
								<Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 5 }}>
									{playlist.id === 'smartCollections'
										? i18n.t('library.collectionCount', { count: smartPlaylists.length })
										: i18n.t('library.shortSongCount', { count: playlist.tracks.length })}
								</Text>
							</View>
							<Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
						</Pressable>
					))}
				</View>
				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'space-between',
						marginTop: 24,
						marginBottom: 8,
					}}
				>
					<Text style={{ color: colors.text, fontSize: 25, fontWeight: '800' }}>
						{i18n.t('library.myPlaylists')}
					</Text>
					<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
						<Pressable
							onPress={() => setShowSearch((value) => !value)}
							accessibilityLabel={i18n.t('find.inFavorites')}
							style={{ padding: 6 }}
						>
							<Ionicons name="search-outline" size={19} color={colors.textMuted} />
						</Pressable>
						<Pressable
							onPress={() => router.navigate('/(modals)/importPlayList')}
							accessibilityLabel={i18n.t('playlistManager.title')}
							style={{
								width: 34,
								height: 34,
								borderRadius: 17,
								backgroundColor: colors.primary,
								alignItems: 'center',
								justifyContent: 'center',
							}}
						>
							<Ionicons name="add" size={25} color="#fff" />
						</Pressable>
					</View>
				</View>
				<PlaylistsList
					presentation="library"
					scrollEnabled={false}
					contentContainerStyle={{ paddingTop: 4, paddingBottom: 0 }}
					playlists={sortLibraryPlaylists((storedPlayLists ?? []) as Playlist[])}
					onPlaylistPress={handlePlaylistPress}
				/>
			</ScrollView>
		</View>
	)
}

export default FavoritesScreen
