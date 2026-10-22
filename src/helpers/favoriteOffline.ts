import { importedLocalMusicStore } from '@/player/PlayerStore'
import PersistStatus from '@/store/PersistStatus'
import {
	getCacheFileUri,
	getPlaybackCachedAudioInfo,
	markSavedOffline,
} from '@/player/CacheManager'
import { enqueueDownload } from '@/player/DownloadManager'
import { isFavoriteTrack } from './favoriteGroups'
import { showToast } from '@/utils/utils'
import i18n from '@/utils/i18n'
import type { Track } from '@/player/types'

const pending = new Set<string>()
/** Called only after an explicit favorite commit; imports and startup never download a library. */
export async function saveNewFavoriteOffline(track: Track) {
	const key = JSON.stringify([track.platform, track.originalId || track.id])
	if (
		pending.has(key) ||
		track.platform === 'local' ||
		PersistStatus.get('music.favoriteAutoSave') !== true
	)
		return
	const stillWanted = () =>
		PersistStatus.get('music.favoriteAutoSave') === true &&
		(PersistStatus.get('music.favorites') ?? []).some((item) => isFavoriteTrack(item, track))
	pending.add(key)
	try {
		const cached = await getPlaybackCachedAudioInfo(track as IMusic.IMusicItem)
		if (!stillWanted()) return
		if (cached) {
			markSavedOffline(cached.localPath)
			const localTracks = importedLocalMusicStore.getValue() ?? []
			const updated = localTracks.map((item) =>
				(item.url === cached.localPath || item.url === getCacheFileUri(cached.localPath)) &&
				item.cacheKind !== 'saved'
					? { ...item, cacheKind: 'saved' as const }
					: item,
			)
			if (updated.some((item, index) => item !== localTracks[index])) {
				PersistStatus.set('music.importedLocalMusic', updated)
				importedLocalMusicStore.setValue(updated)
			}
			showToast(i18n.t('personalOffline.retained'), track.title, 'success')
		} else {
			await enqueueDownload(track as IMusic.IMusicItem, {
				kind: 'saved',
				quality: PersistStatus.get('music.favoriteOfflineQuality') ?? '320k',
				strictQuality: true,
				favoriteAutoSave: true,
				silent: true,
			})
			showToast(i18n.t('personalOffline.queued'), track.title, 'info')
		}
	} catch {
		showToast(i18n.t('personalOffline.failed'), track.title, 'error')
	} finally {
		pending.delete(key)
	}
}
