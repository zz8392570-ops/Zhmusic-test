import { Alert } from 'react-native'
import { getFreeDiskStorageAsync } from 'expo-file-system/legacy'
import type { Track } from '@/player/types'
import i18n from '@/utils/i18n'
import { estimateDownloadSize, formatStorageBytes, getDownloadCandidates } from './downloadPreview'

let preparing = false
export async function confirmPlaylistDownload(
	tracks: readonly Track[],
	quality: IMusic.IQualityKey,
	enqueue: (
		tracks: IMusic.IMusicItem[],
		options: { quality: IMusic.IQualityKey; strictQuality: true },
	) => Promise<unknown>,
	onPreviewClosed?: () => void,
) {
	if (preparing) {
		onPreviewClosed?.()
		return
	}
	const candidates = getDownloadCandidates(tracks)
	if (!candidates.length) {
		onPreviewClosed?.()
		return
	}
	preparing = true
	let closed = false
	const closePreview = () => {
		if (closed) return
		closed = true
		preparing = false
		onPreviewClosed?.()
	}
	try {
		const estimate = estimateDownloadSize(candidates, quality)
		let free: number | null = null
		try {
			const value = await getFreeDiskStorageAsync()
			if (Number.isFinite(value) && value >= 0) free = value
		} catch {
			/* Unknown disk availability must not be displayed as zero. */
		}
		const message = [
			i18n.t('offline.previewCount', { count: candidates.length, quality: quality.toUpperCase() }),
			i18n.t('offline.estimated', {
				size: estimate.unknown
					? i18n.t(estimate.bytes ? 'offline.partialEstimate' : 'offline.unknownEstimate', {
							size: formatStorageBytes(estimate.bytes),
							count: estimate.unknown,
						})
					: formatStorageBytes(estimate.bytes),
			}),
			i18n.t('offline.free', {
				size: free === null ? i18n.t('offline.unknownSpace') : formatStorageBytes(free),
			}),
			...(free !== null && estimate.bytes > free ? [i18n.t('offline.lowSpace')] : []),
			i18n.t('offline.estimateHint'),
		].join('\n\n')
		Alert.alert(
			i18n.t('offline.previewTitle'),
			message,
			[
				{
					text: i18n.t('find.cancel'),
					style: 'cancel',
					onPress: () => {
						closePreview()
					},
				},
				{
					text: i18n.t('offline.confirmDownload'),
					onPress: () => {
						if (closed) return
						closePreview()
						void enqueue(candidates as IMusic.IMusicItem[], { quality, strictQuality: true }).catch(
							() => Alert.alert(i18n.t('cacheCenter.downloadFailed')),
						)
					},
				},
			],
			{
				cancelable: true,
				onDismiss: () => {
					closePreview()
				},
			},
		)
	} catch {
		closePreview()
		Alert.alert(i18n.t('cacheCenter.downloadFailed'))
	}
}
