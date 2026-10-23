import myTrackPlayer, { MusicRepeatMode } from './trackPlayerIndex'
import {
	getListeningCollection,
	getListeningScenes,
	startListeningScene,
} from './listeningSceneActions'
import i18n from '@/utils/i18n'
export async function executePersonalLink(action: unknown, id: unknown, signal?: AbortSignal) {
	if (signal?.aborted) return false
	if (action === 'resume') {
		if (!(await myTrackPlayer.continueLastSession()))
			throw Error(i18n.t('personalFeatures.noSongs'))
		return true
	}
	if (action === 'scene' && typeof id === 'string') {
		const scene = getListeningScenes().find((item) => item.id === id)
		if (!scene) throw Error(i18n.t('personalFeatures.sceneGone'))
		return startListeningScene(scene, signal)
	}
	if (
		action === 'favorites' ||
		(action === 'playlist' && typeof id === 'string' && id.length <= 1024)
	) {
		const tracks = getListeningCollection(action === 'favorites' ? 'favorites' : (id as string))
		if (!tracks) throw Error(i18n.t('personalFeatures.collectionGone'))
		if (!tracks.length) throw Error(i18n.t('personalFeatures.noSongs'))
		myTrackPlayer.setRepeatMode(MusicRepeatMode.QUEUE)
		await myTrackPlayer.playWithReplacePlayList(tracks[0], tracks, true)
		return true
	}
	throw Error(i18n.t('personalFeatures.invalidLink'))
}
