import PersistStatus from '@/store/PersistStatus'
import myTrackPlayer, { MusicRepeatMode } from './trackPlayerIndex'
import { scanPlaylistOffline } from './playlistOffline'
import {
	defaultScenes,
	personalTracks,
	filterTaggedTracks,
	type ListeningScene,
} from './personalFeatures'
import { setTimingClose } from '@/utils/timingClose'
import i18n from '@/utils/i18n'
export const getListeningScenes = () =>
	PersistStatus.get('music.listeningScenes') ??
	defaultScenes(i18n.t('personalFeatures.commute'), i18n.t('personalFeatures.sleep'))
export function getListeningCollection(id: string): IMusic.IMusicItem[] | null {
	if (id === 'favorites') return PersistStatus.get('music.favorites') ?? []
	const dynamic = (PersistStatus.get('music.tagCollections') ?? []).find((item) => item.id === id)
	if (dynamic) {
		const favorites = PersistStatus.get('music.favorites') ?? []
		return filterTaggedTracks(
			personalTracks(
				favorites,
				PersistStatus.get('music.playLists') ?? [],
				PersistStatus.get('music.importedLocalMusic') ?? [],
			),
			PersistStatus.get('music.trackTags') ?? {},
			favorites,
			dynamic.tags,
			dynamic.matchAll,
		) as IMusic.IMusicItem[]
	}
	const playlist = (PersistStatus.get('music.playLists') ?? []).find((item) => item.id === id)
	return playlist ? playlist.songs ?? [] : null
}
let operation = 0
export const cancelSceneStart = () => {
	operation++
}
export async function startListeningScene(scene: ListeningScene, signal?: AbortSignal) {
	const token = ++operation,
		revision = myTrackPlayer.getPlaybackRevision()
	let tracks = getListeningCollection(scene.collectionId)
	if (!tracks) throw Error(i18n.t('personalFeatures.collectionGone'))
	const baseline = JSON.stringify(tracks)
	if (scene.offlineOnly || PersistStatus.get('music.offlinePlayback')) {
		const rows = await scanPlaylistOffline(tracks, signal ?? new AbortController().signal)
		tracks =
			rows
				?.filter((item) => item.state === 'available')
				.map((item) => item.track as IMusic.IMusicItem) ?? []
	}
	if (
		signal?.aborted ||
		token !== operation ||
		revision !== myTrackPlayer.getPlaybackRevision() ||
		JSON.stringify(getListeningCollection(scene.collectionId)) !== baseline
	)
		return false
	if (!tracks.length) throw Error(i18n.t('personalFeatures.noSongs'))
	// Schedule first; a denied native timer must not misleadingly start a sleep scene without its timer.
	if (!setTimingClose(scene.sleepMinutes ? Date.now() + scene.sleepMinutes * 60_000 : null))
		throw Error(i18n.t('personalFeatures.timerFailed'))
	myTrackPlayer.setRepeatMode(scene.shuffle ? MusicRepeatMode.SHUFFLE : MusicRepeatMode.QUEUE)
	await myTrackPlayer.playWithReplacePlayList(tracks[0], tracks, true)
	return true
}
