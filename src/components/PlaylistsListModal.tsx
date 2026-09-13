import { PlaylistListItem } from '@/components/PlaylistListItem'
import { unknownTrackImageUri } from '@/constants/images'
import { playListsStore } from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { useNavigationSearch } from '@/hooks/useNavigationSearch'
import { useFavorites } from '@/store/library'
import { useUtilsStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useMemo } from 'react'
import { FlatList, FlatListProps, Text, View } from 'react-native'
import { Image } from 'expo-image'
type PlaylistsListProps = {
	onPlaylistPress: (playlist: IMusic.PlayList) => void
} & Partial<FlatListProps<Playlist>>

export const PlaylistsListModal = ({
	onPlaylistPress: handlePlaylistPress,
	...flatListProps
}: PlaylistsListProps) => {
	const utilsStyles = useUtilsStyles()
	const search = useNavigationSearch({
		searchBarOptions: {
			placeholder: i18n.t('find.inPlaylist'),
			cancelButtonText: i18n.t('find.cancel'),
		},
	})
	const { favorites } = useFavorites()
	const favoritePlayListItem = useMemo(
		() => ({
			name: 'Favorites',
			id: 'favorites',
			tracks: favorites,
			title: i18n.t('appTab.favoritesSongs'),
			coverImg: 'https://y.qq.com/mediastyle/global/img/cover_like.png?max_age=2592000',
			description: i18n.t('appTab.favoritesSongs'),
		}),
		[favorites],
	)
	const storedPlayLists = playListsStore.useValue()
	const filteredPlayLists = useMemo(() => {
		const playLists = [favoritePlayListItem, ...(storedPlayLists ?? [])]

		if (!search) return playLists

		const keyword = search.toLocaleLowerCase()
		return playLists.filter((playlist: Playlist) =>
			[playlist.title, playlist.name]
				.filter(Boolean)
				.join(' ')
				.toLocaleLowerCase()
				.includes(keyword),
		)
	}, [search, favoritePlayListItem, storedPlayLists])
	const itemDivider = useMemo(
		() => () => (
			<View style={{ ...utilsStyles.itemSeparator, marginLeft: 80, marginVertical: 12 }} />
		),
		[utilsStyles],
	)
	const emptyListComponent = useMemo(
		() => (
			<View>
				<Text style={utilsStyles.emptyContentText}>{i18n.t('find.noResults')}</Text>

				<Image
					contentFit="cover"
					cachePolicy="memory-disk"
					priority="normal"
					source={{ uri: unknownTrackImageUri }}
					style={utilsStyles.emptyContentImage}
				/>
			</View>
		),
		[utilsStyles],
	)
	return (
		<FlatList
			contentContainerStyle={{ paddingTop: 10, paddingBottom: 128 }}
			ItemSeparatorComponent={itemDivider}
			ListFooterComponent={itemDivider}
			ListEmptyComponent={emptyListComponent}
			data={filteredPlayLists}
			renderItem={({ item: playlist }) => (
				<PlaylistListItem
					playlist={playlist as Playlist}
					onPress={() => handlePlaylistPress(playlist as IMusic.PlayList)}
				/>
			)}
			{...flatListProps}
		/>
	)
}
