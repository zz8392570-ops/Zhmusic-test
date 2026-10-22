import { getFavoriteMergeCandidates } from '@/helpers/favoriteGroups'
import { LibraryToolButton } from '@/components/LibraryToolButton'
import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { Playlist } from '@/helpers/types'
import { useFavorites } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Track } from '@/player/types'
import type { MenuAction } from '@react-native-menu/menu'
const FavoriteMusicScreen = () => {
	const router = useRouter()
	const defaultStyles = useDefaultStyles()
	// const search = useNavigationSearch({
	// 	searchBarOptions: {
	// 		placeholder: 'Find in favorites',
	// 	},
	// })

	const { favorites } = useFavorites()
	const duplicateCount = useMemo(() => getFavoriteMergeCandidates(favorites).length, [favorites])
	const playListItem = {
		name: 'Favorites',
		id: 'favorites',
		tracks: [],
		title: i18n.t('appTab.favoritesSongs'),
		coverImg: 'https://y.qq.com/mediastyle/global/img/cover_like.png?max_age=2592000',
		description: i18n.t('appTab.favoritesSongs'),
	}
	const filteredFavoritesTracks = useMemo(() => {
		// if (!search) return favorites as Track[]

		return favorites as Track[]
	}, [favorites])
	const repairFavorites = () =>
		router.push({ pathname: '/(modals)/libraryRepair', params: { target: 'favorites' } })
	const managementActions = useMemo<MenuAction[]>(
		() => [
			{ id: 'versions', title: i18n.t('versions.title'), image: 'slider.horizontal.3' },
			{ id: 'duplicates', title: i18n.t('favoriteGroups.title'), image: 'square.stack.3d.up' },
			{
				id: 'repair',
				title: i18n.t('playlistTools.repairUnavailable'),
				image: 'wrench.and.screwdriver',
			},
		],
		[],
	)

	return (
		<View style={defaultStyles.container}>
			<PlaylistTracksList
				contentContainerStyle={{ paddingHorizontal: 18 }}
				playlist={playListItem as Playlist}
				tracks={filteredFavoritesTracks}
				headerContent={
					duplicateCount ? (
						<LibraryToolButton
							title={i18n.t('favoriteGroups.reviewNotice', { count: duplicateCount })}
							onPress={() => router.push('/(modals)/favoriteDuplicates')}
						/>
					) : null
				}
				managementActions={managementActions}
				onManagementAction={(action) => {
					if (action === 'versions') router.push('/(modals)/favoriteVersions')
					else if (action === 'duplicates') router.push('/(modals)/favoriteDuplicates')
					else repairFavorites()
				}}
			/>
		</View>
	)
}
export default FavoriteMusicScreen
