import { router } from 'expo-router'

let requestSequence = 0
export const searchSongByTitle = (title?: string) => {
	const query = title?.trim()
	if (!query) return
	router.dismissTo({
		pathname: '/(tabs)/search',
		params: { query, songSearchRequest: `${Date.now()}_${++requestSequence}` },
	})
}
