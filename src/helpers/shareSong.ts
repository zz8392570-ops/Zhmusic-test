import { Alert, Clipboard, Platform, Share } from 'react-native'
import type { MenuAction } from '@react-native-menu/menu'
import type { Track } from '@/player/types'
import i18n from '@/utils/i18n'
import { showToast } from '@/utils/utils'
import { logError } from './logger'
import { resolveLocalFile } from './localFile'
import { getSongPageUrl, isLocalSongUrl } from './songSharing'
import { shareLocalFiles } from '../../modules/cymusic-native/sharing'

let sharing = false
const metadata = (track: Track) => ({
	title:
		typeof track.title === 'string' && track.title.trim()
			? track.title.trim()
			: i18n.t('find.unknownSong'),
	artist:
		typeof track.artist === 'string' && track.artist.trim()
			? track.artist.trim()
			: i18n.t('find.unknownArtist'),
})
export function buildSongShareContent(track: Track) {
	const { title, artist } = metadata(track)
	const message = i18n.t('player.shareMessage', { title, artist })
	const url = getSongPageUrl(track)
	return {
		title,
		message: Platform.OS === 'android' && url ? `${message}\n${url}` : message,
		...(url ? { url } : {}),
	}
}

export const getSongShareActions = (track?: Track | null): MenuAction[] => [
	{ id: 'share', title: i18n.t('player.shareInfo') },
	{ id: 'copy-song', title: i18n.t('player.copySong') },
	...(isLocalSongUrl(track?.url) ? [{ id: 'share-file', title: i18n.t('player.shareFile') }] : []),
]

export async function copySongInfo(track?: Track | null) {
	if (!track) {
		Alert.alert(i18n.t('player.shareUnavailable'))
		return
	}
	try {
		const { title, artist } = metadata(track)
		await Clipboard.setString(`${title} - ${artist}`)
		showToast(i18n.t('player.songCopied'))
	} catch (error) {
		logError('复制歌曲失败:', error)
		Alert.alert(i18n.t('player.copyFailed'))
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
		await Share.share(buildSongShareContent(track))
	} catch (error) {
		logError('分享歌曲失败:', error)
		Alert.alert(i18n.t('player.shareFailed'))
	} finally {
		sharing = false
	}
}

export async function shareSongFile(track?: Track | null) {
	if (sharing) return
	if (!track) {
		Alert.alert(i18n.t('player.shareUnavailable'))
		return
	}
	sharing = true
	try {
		const local = await resolveLocalFile(track.url, { requireOwnedMedia: true })
		if (local.status !== 'resolved') {
			Alert.alert(i18n.t('player.shareFileMissing'))
			return
		}
		await shareLocalFiles([local.filePath])
	} catch (error) {
		logError('分享歌曲文件失败:', error)
		Alert.alert(i18n.t('player.shareFailed'))
	} finally {
		sharing = false
	}
}
