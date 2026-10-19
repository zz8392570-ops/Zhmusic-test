import PersistStatus from '@/store/PersistStatus'
import myTrackPlayer, { playListsStore } from '@/helpers/trackPlayerIndex'
import {
	fetchImportedPlaylistSongs,
	getImportedPlaylistSource,
	mergeConcurrentImportedPlaylistRefresh,
} from './importPlaylist'
import { getLibraryTrackKey } from './libraryEdits'
import { AppState } from 'react-native'
import * as Network from 'expo-network'

let running: Promise<void> | null = null
let generation = 0
const due = (playlist: IMusic.PlayList, now: number, days: number) => {
	const status = PersistStatus.get('library.refreshStatus')?.[playlist.id]
	const last = Math.max(playlist.sourceLastRefreshedAt ?? 0, status?.checkedAt ?? 0)
	return now - last >= (status?.error ? 3600_000 : days * 86400_000)
}
export const runPlaylistAutoRefresh = () => {
	if (running) return running
	const owner = generation
	running = (async () => {
		const days = PersistStatus.get('library.autoRefresh') ?? 0
		if (!days || AppState.currentState !== 'active') return
		const network = await Network.getNetworkStateAsync()
		if (
			network.isConnected === false ||
			![Network.NetworkStateType.WIFI, Network.NetworkStateType.ETHERNET].includes(network.type)
		)
			return
		const ids = (playListsStore.getValue() ?? [])
			.filter((item) => getImportedPlaylistSource(item) && due(item, Date.now(), days))
			.map((item) => item.id)
		for (const id of ids) {
			if (
				owner !== generation ||
				AppState.currentState !== 'active' ||
				PersistStatus.get('library.autoRefresh') !== days
			)
				break
			const latest = (playListsStore.getValue() ?? []).find((item) => item.id === id)
			if (!latest || !getImportedPlaylistSource(latest)) continue
			const baseline = JSON.parse(JSON.stringify(latest)) as IMusic.PlayList
			let timer: ReturnType<typeof setTimeout> | undefined
			try {
				const remote = await Promise.race([
					fetchImportedPlaylistSongs(baseline),
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => reject(new Error('Refresh timed out')), 30_000)
					}),
				])
				if (
					owner !== generation ||
					AppState.currentState !== 'active' ||
					PersistStatus.get('library.autoRefresh') !== days
				)
					continue
				const result = myTrackPlayer.updateStoredPlaylist(id, (current) => {
					const source = getImportedPlaylistSource(current),
						initial = getImportedPlaylistSource(baseline)
					if (
						!source ||
						!initial ||
						source.source !== initial.source ||
						source.id !== initial.id ||
						current.sourceLastRefreshedAt !== baseline.sourceLastRefreshedAt
					)
						return null
					const merged = mergeConcurrentImportedPlaylistRefresh(
						baseline,
						current,
						remote.songs,
						remote.sourcePlaylistId,
					)
					const keys = new Set(current.songs.map(getLibraryTrackKey))
					const removedLocally = new Set<string>(
						(current.sourceSnapshotKeys ?? []).filter((key: string) => !keys.has(key)),
					)
					const byKey = new Map(
						merged.songs
							.filter((song) => !removedLocally.has(getLibraryTrackKey(song)))
							.map((song) => [getLibraryTrackKey(song), song]),
					)
					const songs = current.songs.flatMap((song) => {
						const key = getLibraryTrackKey(song),
							value = byKey.get(key)
						byKey.delete(key)
						return value ? [value] : []
					})
					const nextSongs = [...songs, ...byKey.values()]
					const nextKeys = new Set(nextSongs.map(getLibraryTrackKey))
					const status = {
						checkedAt: Date.now(),
						added: nextSongs.filter((song) => !keys.has(getLibraryTrackKey(song))).length,
						removed: current.songs.filter((song) => !nextKeys.has(getLibraryTrackKey(song))).length,
					}
					PersistStatus.set('library.refreshStatus', {
						...(PersistStatus.get('library.refreshStatus') ?? {}),
						[id]: status,
					})
					return {
						songs: nextSongs,
						sourceSnapshotKeys: merged.sourceSnapshotKeys,
						sourcePlaylistId: merged.sourcePlaylistId,
						sourceLastRefreshedAt: merged.sourceLastRefreshedAt,
						sourceOverrides: merged.sourceOverrides,
					}
				})
				if (result !== 'success' && result !== 'not-found' && result !== 'conflict')
					throw new Error('Refresh save failed')
			} catch {
				if (owner === generation)
					PersistStatus.set('library.refreshStatus', {
						...(PersistStatus.get('library.refreshStatus') ?? {}),
						[id]: { checkedAt: Date.now(), error: true },
					})
			} finally {
				if (timer !== undefined) clearTimeout(timer)
			}
		}
	})().finally(() => {
		running = null
	})
	return running
}
export const startPlaylistAutoRefresh = () => {
	const invoke = () => {
		void runPlaylistAutoRefresh().catch(() => {})
	}
	invoke()
	const app = AppState.addEventListener('change', (state) => {
		if (state === 'active') invoke()
		else generation++
	})
	const unsubscribe = PersistStatus.subscribe((key) => {
		if (key === 'library.autoRefresh') {
			generation++
			invoke()
		}
	})
	const network = Network.addNetworkStateListener(invoke)
	const timer = setInterval(invoke, 15 * 60_000)
	return () => {
		generation++
		app.remove()
		unsubscribe()
		network.remove()
		clearInterval(timer)
	}
}
