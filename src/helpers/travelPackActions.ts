import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'
import { enqueueDownload } from '@/player/DownloadManager'
import { personalTrackKey } from './personalFeatures'
import { inspectTravelCollection, prepareTravelMetadata } from './travelPreparation'

export async function prepareTravelPack(
	getTracks: () => readonly Track[] | null,
	approvedAudio: ReadonlySet<string>,
	quality: IMusic.IQualityKey,
	signal: AbortSignal,
	progress: (done: number, total: number, failed: number) => void,
) {
	const tracks = getTracks()
	if (!tracks || signal.aborted) return null
	if (PersistStatus.get('music.offlinePlayback')) throw Error('OFFLINE_PLAYBACK')
	const entries = await inspectTravelCollection(tracks, signal)
	if (!entries || signal.aborted || !getTracks()) return null
	for (const entry of entries) {
		if (signal.aborted || !getTracks()) return null
		if (
			entry.audio ||
			entry.unknown ||
			entry.track.platform === 'local' ||
			!approvedAudio.has(personalTrackKey(entry.track))
		)
			continue
		// Approval covers only these identities; songs removed since confirmation are excluded.
		if (!getTracks()?.some((track) => personalTrackKey(track) === personalTrackKey(entry.track)))
			continue
		await enqueueDownload(
			{
				...entry.track,
				id: entry.track.originalId || entry.track.id,
				url: 'Unknown',
			} as IMusic.IMusicItem,
			{ quality, strictQuality: true, wifiOnly: true, kind: 'saved' },
		)
	}
	if (signal.aborted || !getTracks()) return null
	const latest = new Set(getTracks()!.map(personalTrackKey))
	const retained = entries.filter((entry) => latest.has(personalTrackKey(entry.track)))
	const result = await prepareTravelMetadata(retained, signal, (done, failed) =>
		progress(done, retained.length, failed),
	)
	const current = getTracks()
	if (signal.aborted || !current) return null
	const checked = await inspectTravelCollection(current, signal)
	return checked && !signal.aborted ? { ...result, entries: checked } : null
}
