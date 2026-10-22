import { getPlaybackCachedAudioInfo, getCacheFileUri } from '@/player/CacheManager'
import { resolveLocalFile } from './localFile'
import type { Track } from '@/player/types'

export type PlaylistOfflineEntry = {
	track: Track
	state: 'available' | 'online' | 'missing' | 'unknown'
}
export async function inspectPlaylistTrack(track: Track): Promise<PlaylistOfflineEntry> {
	try {
		const local = await resolveLocalFile(track.url, { requireOwnedMedia: true })
		if (local.status === 'resolved') return { track, state: 'available' }
		const cached = await getPlaybackCachedAudioInfo(track as IMusic.IMusicItem)
		if (cached) {
			const file = await resolveLocalFile(getCacheFileUri(cached.localPath), {
				requireOwnedMedia: true,
			})
			if (file.status === 'resolved') return { track, state: 'available' }
			return {
				track,
				state: file.status === 'unresolved' && file.reason === 'missing' ? 'missing' : 'unknown',
			}
		}
		return {
			track,
			state:
				local.status === 'nonlocal' ? 'online' : local.reason === 'missing' ? 'missing' : 'unknown',
		}
	} catch {
		return { track, state: 'unknown' }
	}
}
/** Bound filesystem work and retire queued probes when a screen or library changes. */
export async function scanPlaylistOffline(tracks: readonly Track[], signal: AbortSignal) {
	const entries: PlaylistOfflineEntry[] = new Array(tracks.length)
	let next = 0
	await Promise.all(
		Array.from({ length: Math.min(4, tracks.length) }, async () => {
			while (!signal.aborted && next < tracks.length) {
				const index = next++
				entries[index] = await inspectPlaylistTrack(tracks[index])
			}
		}),
	)
	return signal.aborted ? null : entries
}
export const missingDownloadTracks = (entries: readonly PlaylistOfflineEntry[]) =>
	entries
		.filter(
			({ track, state }) =>
				track.platform !== 'local' && (state === 'online' || state === 'missing'),
		)
		.map(({ track }) => ({ ...track, id: track.originalId || track.id, url: 'Unknown' }))
