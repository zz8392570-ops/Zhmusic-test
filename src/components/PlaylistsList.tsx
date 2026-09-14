import { PlaylistListItem } from '@/components/PlaylistListItem'
import { unknownTrackImageUri } from '@/constants/images'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { useUtilsStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useMemo } from 'react'
import { Alert, FlatList, FlatListProps, Text, View } from 'react-native'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
type PlaylistsListProps = {
	playlists: Playlist[]
	onPlaylistPress: (playlist: Playlist) => void
} & Partial<FlatListProps<Playlist>>

export const PlaylistsList = ({
	playlists,
	onPlaylistPress: handlePlaylistPress,
	...flatListProps
}: PlaylistsListProps) => {
	const utilsStyles = useUtilsStyles()
	const itemDivider = useMemo(
		() => () => (
			<View style={{ ...utilsStyles.itemSeparator, marginLeft: 80, marginVertical: 12 }} />
		),
		[utilsStyles],
	)
	const emptyListComponent = useMemo(
		() => (
			<View>
				<Text style={utilsStyles.emptyContentText}>{i18n.t('library.empty')}</Text>
				<Text style={[utilsStyles.emptyContentText, { fontSize: 14, marginTop: 4, opacity: 0.7 }]}>
					{i18n.t('library.emptyHint')}
				</Text>

				<Image
					accessible={false}
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

	const showDeleteAlert = (playlist: Playlist) => {
		if (playlist.id === 'favorites' || playlist.id === 'local' || playlist.id === 'recent') return

		Alert.alert(
			i18n.t('library.deleteTitle'),
			i18n.t('library.deleteMessage', { name: playlist.title || playlist.name }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('library.delete'),
					style: 'destructive',
					onPress: async () => {
						try {
							const result = await myTrackPlayer.deletePlayLists(playlist.id)
							if (result !== 'success') {
								Alert.alert(i18n.t('library.deleteFailed'))
								return
							}
							Alert.alert(
								i18n.t('library.deletedTitle'),
								i18n.t('library.deletedMessage', { name: playlist.title || playlist.name }),
								[
									{ text: i18n.t('library.done'), style: 'cancel' },
									{
										text: i18n.t('library.undo'),
										onPress: () => myTrackPlayer.addPlayLists(playlist as IMusic.PlayList),
									},
								],
							)
						} catch {
							Alert.alert(i18n.t('library.deleteFailed'))
						}
					},
				},
			],
		)
	}

	const editPlaylist = (playlist: Playlist) => {
		const rename = () => {
			Alert.prompt(
				i18n.t('library.renameTitle'),
				i18n.t('library.renameMessage'),
				(name) => {
					const title = name?.trim()
					if (title) myTrackPlayer.updateStoredPlaylist(playlist.id, { name: title, title })
				},
				'plain-text',
				playlist.title || playlist.name,
			)
		}
		const changeCover = async () => {
			try {
				const result = await ImagePicker.launchImageLibraryAsync({
					mediaTypes: ['images'],
					allowsEditing: true,
					aspect: [1, 1],
					quality: 0.85,
				})
				if (!result.canceled) {
					myTrackPlayer.updateStoredPlaylist(playlist.id, {
						artwork: result.assets[0].uri,
						coverImg: result.assets[0].uri,
					})
				}
			} catch {
				Alert.alert(i18n.t('library.editFailed'))
			}
		}
		Alert.alert(i18n.t('library.editTitle'), playlist.title || playlist.name, [
			{ text: i18n.t('library.rename'), onPress: rename },
			{ text: i18n.t('library.changeCover'), onPress: () => void changeCover() },
			{ text: i18n.t('find.cancel'), style: 'cancel' },
		])
	}
	return (
		<FlatList
			contentContainerStyle={{ paddingTop: 10, paddingBottom: 128 }}
			ItemSeparatorComponent={itemDivider}
			ListFooterComponent={playlists.length > 0 ? itemDivider : null}
			ListEmptyComponent={emptyListComponent}
			data={playlists}
			renderItem={({ item: playlist }) => (
				<PlaylistListItem
					playlist={playlist}
					onPress={() => handlePlaylistPress(playlist)}
					onLongPress={
						playlist.id === 'favorites' || playlist.id === 'local' || playlist.id === 'recent'
							? undefined
							: () => showDeleteAlert(playlist)
					}
					onDeletePress={
						playlist.id === 'favorites' || playlist.id === 'local' || playlist.id === 'recent'
							? undefined
							: () => showDeleteAlert(playlist)
					}
					onEditPress={
						playlist.id === 'favorites' || playlist.id === 'local' || playlist.id === 'recent'
							? undefined
							: () => editPlaylist(playlist)
					}
				/>
			)}
			{...flatListProps}
		/>
	)
}
