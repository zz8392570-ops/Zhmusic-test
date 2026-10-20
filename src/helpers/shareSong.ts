import { Alert, Platform, Share } from 'react-native'
import type { Track } from '@/player/types'
import i18n from '@/utils/i18n'
import { logError } from './logger'
import { resolveLocalFile } from './localFile'

let sharing = false

export function buildSongShareContent(track: Track) {
	const title =
		typeof track.title === 'string' && track.title.trim()
			? track.title.trim()
			: i18n.t('find.unknownSong')
	const artist =
		typeof track.artist === 'string' && track.artist.trim()
			? track.artist.trim()
			: i18n.t('find.unknownArtist')
	const message = i18n.t('player.shareMessage', { title, artist })
	let url: string | undefined
	try {
		const parsed = new URL(typeof track.url === 'string' ? track.url.trim() : '')
		if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href
	} catch {
		// Pending sources, missing links and local paths still have shareable text.
	}
	return {
		title,
		message: Platform.OS === 'android' && url ? `${message}\n${url}` : message,
		...(url ? { url } : {}),
	}
}

export async function shareSong(track?: Track | null) {
	if (sharing) return
	if (!track) {
		Alert.alert(i18n.t('player.shareUnavailable'))
		return
	}
	sharing = true
	try {
		const content = buildSongShareContent(track)
		const local = Platform.OS === 'ios' ? await resolveLocalFile(track.url) : null
		await Share.share(local?.status === 'resolved' ? { ...content, url: local.fileUri } : content)
	} catch (error) {
		logError('分享歌曲失败:', error)
		Alert.alert(i18n.t('player.shareFailed'))
	} finally {
		sharing = false
	}
}
