import { useFavorites } from '@/store/library'
import { useCallback } from 'react'
import { currentMusicStore } from '@/player/PlayerStore'
import { isFavoriteTrack } from '@/helpers/favoriteGroups'

export const useTrackPlayerFavorite = () => {
	const activeTrack = currentMusicStore.useValue()

	const { favorites, toggleTrackFavorite } = useFavorites()

	const isFavorite = !!activeTrack && favorites.some((track) => isFavoriteTrack(track, activeTrack))

	const toggleFavorite = useCallback(() => {
		if (activeTrack) {
			toggleTrackFavorite(activeTrack)
		}
	}, [toggleTrackFavorite, activeTrack])

	return { isFavorite, toggleFavorite }
}
