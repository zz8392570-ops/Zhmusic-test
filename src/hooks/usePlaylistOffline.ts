import { useCallback, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { scanPlaylistOffline, type PlaylistOfflineEntry } from '@/helpers/playlistOffline'
import { cacheRevisionStore, importedLocalMusicStore } from '@/player/PlayerStore'
import PersistStatus from '@/store/PersistStatus'
import type { Track } from '@/player/types'

export function usePlaylistOffline(tracks: Track[], enabled: boolean) {
	const revision = cacheRevisionStore.useValue()
	const localTracks = importedLocalMusicStore.useValue()
	const favorites = PersistStatus.useValue('music.favorites')
	const libraryVersion = useMemo(() => ({ favorites, localTracks }), [favorites, localTracks])
	const [result, setResult] = useState<{
		tracks: Track[]
		revision: number
		libraryVersion: object
		entries: PlaylistOfflineEntry[]
	} | null>(null)
	useFocusEffect(
		useCallback(() => {
			if (!enabled) return
			let controller: AbortController | undefined
			const scan = () => {
				controller?.abort()
				const owner = new AbortController()
				controller = owner
				setResult(null)
				void scanPlaylistOffline(tracks, owner.signal).then((entries) => {
					if (entries && !owner.signal.aborted && cacheRevisionStore.getValue() === revision)
						setResult({ tracks, revision, libraryVersion, entries })
				})
			}
			scan()
			const subscription = AppState.addEventListener('change', (state) => {
				if (state === 'active') scan()
			})
			return () => {
				controller?.abort()
				subscription.remove()
			}
		}, [tracks, enabled, revision, libraryVersion]),
	)
	return enabled &&
		result?.tracks === tracks &&
		result.revision === revision &&
		result.libraryVersion === libraryVersion
		? result.entries
		: null
}
