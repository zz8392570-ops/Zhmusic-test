import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { screenPadding } from '@/constants/tokens'
import { Playlist } from '@/helpers/types'
import { replaceFavorites, useFavorites } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import React, { useCallback, useMemo, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import type { Track } from '@/player/types'
import { repairUnavailableTracks } from '@/helpers/libraryRepair'
import type { MenuAction } from '@react-native-menu/menu'
const FavoriteMusicScreen = () => {
	const defaultStyles = useDefaultStyles()
	// const search = useNavigationSearch({
	// 	searchBarOptions: {
	// 		placeholder: 'Find in favorites',
	// 	},
	// })

	const { favorites } = useFavorites()
	const [isRepairing, setIsRepairing] = useState(false)
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
	const repairFavorites = useCallback(async () => {
		if (isRepairing || !favorites.length) return
		setIsRepairing(true)
		try {
			const result = await repairUnavailableTracks(favorites)
			if (result.repaired) replaceFavorites(result.tracks)
			Alert.alert(
				i18n.t('playlistTools.repairComplete'),
				i18n.t('playlistTools.repairSummary', {
					unavailable: result.unavailable,
					repaired: result.repaired,
					review: result.review.length,
				}),
			)
		} catch {
			Alert.alert(i18n.t('playlistTools.repairFailed'))
		} finally {
			setIsRepairing(false)
		}
	}, [favorites, isRepairing])
	const managementActions = useMemo<MenuAction[]>(
		() => [{
			id: 'repair',
			title: i18n.t(isRepairing ? 'playlistTools.repairing' : 'playlistTools.repairUnavailable'),
			image: 'wrench.and.screwdriver',
			attributes: { disabled: isRepairing },
		}],
		[isRepairing],
	)

	return (
		<View style={defaultStyles.container}>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<PlaylistTracksList
					playlist={playListItem as Playlist}
					tracks={filteredFavoritesTracks}
					managementActions={managementActions}
					onManagementAction={() => void repairFavorites()}
				/>
			</ScrollView>
		</View>
	)
}
export default FavoriteMusicScreen
