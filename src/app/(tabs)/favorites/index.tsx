import localImage from '@/assets/local.png'
import { PlaylistsList } from '@/components/PlaylistsList'
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
import { router } from 'expo-router'
import { useMemo } from 'react'
import { Image, ScrollView, View } from 'react-native'

const FavoritesScreen = () => {
	const defaultStyles = useDefaultStyles()
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
			...(storedPlayLists ?? []),
		],
		[storedPlayLists, favorites, localTracks, recentlyPlayed],
	)

	const filteredPlayLists = useMemo(() => {
		if (!search) return playLists as Playlist[]

		const keyword = search.toLocaleLowerCase()
		return playLists.filter((playlist: Playlist) =>
			[playlist.title, playlist.name]
				.filter(Boolean)
				.join(' ')
				.toLocaleLowerCase()
				.includes(keyword),
		) as Playlist[]
	}, [playLists, search])
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
				<PlaylistsList
					scrollEnabled={false}
					playlists={filteredPlayLists as Playlist[]}
					onPlaylistPress={handlePlaylistPress}
				/>
			</ScrollView>
		</View>
	)
}

export default FavoritesScreen
