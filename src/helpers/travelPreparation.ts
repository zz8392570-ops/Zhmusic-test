import * as Network from 'expo-network'
import type { Track } from '@/player/types'
import { inspectPlaylistTrack } from './playlistOffline'
import { myGetLyric } from './userApi/getMusicLyric'
import { resolveLeaderboardArtwork } from './artworkResolver'
import {
	readOfflineArtwork,
	readOfflineLyric,
	saveOfflineArtwork,
	saveOfflineLyric,
	retainOfflineAssets,
} from './offlineAssets'
import {
	getPlaybackCachedAudioInfo,
	getCacheFileUri,
	markSavedOffline,
} from '@/player/CacheManager'
import { importedLocalMusicStore } from '@/player/PlayerStore'
import PersistStatus from '@/store/PersistStatus'
export type TravelEntry = {
	track: Track
	audio: boolean
	lyric: boolean
	artwork: boolean
	unknown: boolean
}
export const wifiAvailable = (state: Network.NetworkState) =>
	state.isConnected !== false &&
	[Network.NetworkStateType.WIFI, Network.NetworkStateType.ETHERNET].includes(state.type)
export async function inspectTravelCollection(
	tracks: readonly Track[],
	signal: AbortSignal,
	progress?: (entries: TravelEntry[]) => void,
) {
	const entries: TravelEntry[] = []
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(3, tracks.length) }, async () => {
			while (!signal.aborted && next < tracks.length) {
				const track = tracks[next++]
				const [audio, lyric, artwork] = await Promise.all([
					inspectPlaylistTrack(track),
					readOfflineLyric(track),
					readOfflineArtwork(track),
				])
				if (signal.aborted) return
				entries.push({
					track,
					audio: audio.state === 'available',
					lyric: !!lyric,
					artwork: !!artwork,
					unknown: audio.state === 'unknown',
				})
				progress?.([...entries])
			}
		}),
	)
	return signal.aborted ? null : entries
}
export async function prepareTravelMetadata(
	entries: readonly TravelEntry[],
	signal: AbortSignal,
	progress: (done: number, failed: number) => void,
) {
	let done = 0,
		failed = 0
	for (const entry of entries) {
		if (signal.aborted) break
		if (PersistStatus.get('music.offlinePlayback')) throw Error('OFFLINE_PLAYBACK')
		if (!wifiAvailable(await Network.getNetworkStateAsync())) throw Error('WIFI_REQUIRED')
		const controller = new AbortController(),
			abort = () => controller.abort()
		signal.addEventListener('abort', abort)
		const unsubscribe = PersistStatus.subscribe((key) => {
			if (key === 'music.offlinePlayback' && PersistStatus.get('music.offlinePlayback')) abort()
		})
		const network = Network.addNetworkStateListener((state) => {
			if (!wifiAvailable(state)) abort()
		})
		try {
			if (signal.aborted) break
			retainOfflineAssets(entry.track)
			// Protect existing cached audio while preparing a trip, without downloading it again.
			if (entry.audio) {
				const cache = await getPlaybackCachedAudioInfo(entry.track as IMusic.IMusicItem)
				if (cache && !controller.signal.aborted) {
					markSavedOffline(cache.localPath)
					const tracks = importedLocalMusicStore.getValue() ?? []
					const updated = tracks.map((item) =>
						item.url === cache.localPath || item.url === getCacheFileUri(cache.localPath)
							? { ...item, cacheKind: 'saved' as const }
							: item,
					)
					if (updated.some((item, index) => item.cacheKind !== tracks[index].cacheKind)) {
						PersistStatus.set('music.importedLocalMusic', updated)
						importedLocalMusicStore.setValue(updated)
					}
				}
			}
			let unavailable = false
			const canonical = {
				...entry.track,
				id:
					entry.track.platform === 'local'
						? entry.track.id
						: entry.track.originalId || entry.track.id,
			} as IMusic.IMusicItem
			if (!entry.lyric && !controller.signal.aborted) {
				const lyrics = await myGetLyric(canonical, controller.signal)
				if (
					!controller.signal.aborted &&
					!(await saveOfflineLyric(entry.track, lyrics, controller.signal))
				)
					unavailable = true
			}
			if (!entry.artwork && !controller.signal.aborted) {
				const url = await resolveLeaderboardArtwork(
					canonical.platform,
					canonical.id,
					canonical.artwork,
				)
				if (
					!controller.signal.aborted &&
					(!url || !(await saveOfflineArtwork(entry.track, url, controller.signal)))
				)
					unavailable = true
			}
			if (!controller.signal.aborted) {
				done++
				if (unavailable) failed++
				progress(done, failed)
			} else if (!signal.aborted) throw Error('WIFI_REQUIRED')
		} catch (error) {
			if ((error as Error).message === 'WIFI_REQUIRED') throw error
			if (!signal.aborted) {
				done++
				failed++
				progress(done, failed)
			}
		} finally {
			signal.removeEventListener('abort', abort)
			unsubscribe()
			network.remove()
		}
	}
	return { done, failed }
}
