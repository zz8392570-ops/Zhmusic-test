import type { MenuAction } from '@react-native-menu/menu'
import i18n from '@/utils/i18n'

export const DOWNLOAD_QUALITIES = ['128k', '320k', 'flac'] as const

export const getDownloadQuality = (actionId: string): IMusic.IQualityKey | undefined =>
	DOWNLOAD_QUALITIES.find((quality) => actionId === `download-quality-${quality}`)

export const getDownloadQualityActions = (): MenuAction[] =>
	DOWNLOAD_QUALITIES.map((quality) => ({
		id: `download-quality-${quality}`,
		title: i18n.t(`downloadQuality.options.${quality}`),
	}))
