import { useFavorites } from '@/store/library'
import { useCallback } from 'react'
import { currentMusicStore } from '@/player/PlayerStore'
import { isSameMediaItem } from '@/utils/mediaItem'

export const useTrackPlayerFavorite = () => {
	const activeTrack = currentMusicStore.useValue()

	const { favorites, toggleTrackFavorite } = useFavorites()

	const isFavorite = !!activeTrack && favorites.some((track) => isSameMediaItem(track, activeTrack))

	const toggleFavorite = useCallback(() => {
		if (activeTrack) {
			toggleTrackFavorite(activeTrack)
		}
	}, [toggleTrackFavorite, activeTrack])

	return { isFavorite, toggleFavorite }
}
