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
import { useNavigationSearch } from '@/hooks/useNavigationSearch'
import { useFavorites } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { sortLibraryPlaylists } from '@/helpers/playlistOrganizer'
import { router } from 'expo-router'
import { useMemo } from 'react'
import { useIsPlaying } from '@rntp/player'
import { Image, ScrollView, Text, View } from 'react-native'

const FavoritesScreen = () => {
	const defaultStyles = useDefaultStyles()
	const colors = useThemeColors()
	const playing = useIsPlaying()
	const currentTrack = myTrackPlayer.useCurrentMusic()
	const search = useNavigationSearch({
		searchBarOptions: {
			placeholder: i18n.t('find.inFavorites'),
			cancelButtonText: i18n.t('find.cancel'),
		},
	})

	const storedPlayLists = playListsStore.useValue()
	const localTracks = importedLocalMusicStore.useValue()
	const recentlyPlayed = recentlyPlayedStore.useValue()
	const { favorites } = useFavorites()
	const playLists = useMemo(
		() => [
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
		],
		[storedPlayLists, favorites, localTracks, recentlyPlayed],
	)

	const results = useMemo(() => searchPersonalLibrary(playLists, search), [playLists, search])
	const filteredPlayLists = results.playlists as Playlist[]
	const handlePlaylistPress = (playlist: Playlist) => {
		if (playlist.id === 'favorites') {
			router.push(`/(tabs)/favorites/favoriteMusic`)
		} else if (playlist.id === 'recent') {
			router.push(`/(tabs)/favorites/recentMusic`)
		} else if (playlist.id === 'local') {
			router.push(`/(tabs)/favorites/localMusic`)
		} else {
			router.push(`/(tabs)/favorites/${playlist.id}`)
		}
	}
	return (
		<View style={defaultStyles.container}>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{
					paddingHorizontal: screenPadding.horizontal,
				}}
			>
				{search.trim() && results.tracks.length ? (
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
				{search.trim() ? (
					<Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 20 }}>
						{i18n.t('library.playlistResults', { count: filteredPlayLists.length })}
					</Text>
				) : null}
				<PlaylistsList
					{...(search.trim()
						? {
								ListEmptyComponent: (
									<Text style={{ color: colors.textMuted, paddingVertical: 20 }}>
										{i18n.t('library.searchNoResults')}
									</Text>
								),
							}
						: {})}
					scrollEnabled={false}
					playlists={filteredPlayLists as Playlist[]}
					onPlaylistPress={handlePlaylistPress}
				/>
			</ScrollView>
		</View>
	)
}

export default FavoritesScreen
