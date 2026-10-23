import { useEffect } from 'react'
import PersonalWidget from '../../modules/cymusic-native/personalWidget'
import PersistStatus from '@/store/PersistStatus'
import { currentMusicStore, playListsStore } from '@/player/PlayerStore'
import { buildWidgetSnapshot } from '@/helpers/widgetSnapshot'
import { defaultScenes } from '@/helpers/personalFeatures'
import i18n from '@/utils/i18n'
export default function PersonalWidgetSync() {
	const track = currentMusicStore.useValue(),
		playlists = playListsStore.useValue(),
		favorites = PersistStatus.useValue('music.favorites', []) ?? []
	const scenes = PersistStatus.useValue('music.listeningScenes'),
		selected = PersistStatus.useValue('widget.collectionId', 'favorites') ?? 'favorites',
		language = PersistStatus.useValue('app.language', i18n.locale) ?? i18n.locale
	useEffect(() => {
		try {
			PersonalWidget?.updateSnapshot(
				JSON.stringify(
					buildWidgetSnapshot(
						track,
						playlists ?? [],
						favorites.length,
						scenes ??
							defaultScenes(i18n.t('personalFeatures.commute'), i18n.t('personalFeatures.sleep')),
						selected,
						language,
					),
				),
			)
		} catch {
			/* Optional extension sync cannot interrupt playback. */
		}
	}, [track, playlists, favorites.length, scenes, selected, language])
	return null
}
