import { useCallback, useState } from 'react'
import { Text } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { Track } from '@/player/types'
import { cacheRevisionStore, cacheDownloadTasksStore } from '@/player/PlayerStore'
import { getOfflineAvailability, type OfflineAvailability } from '@/helpers/offlineAvailability'
import { isLocalSongUrl } from '@/helpers/songSharing'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'

export default function OfflineAvailabilityLabel({ track }: { track: Track }) {
	const colors = useThemeColors()
	const revision = cacheRevisionStore.useValue()
	const tasks = cacheDownloadTasksStore.useValue()
	const task = tasks.find(
		(item) =>
			item.track.platform === track.platform && item.track.id === (track.originalId || track.id),
	)
	const [result, setResult] = useState<{ url: unknown; state: OfflineAvailability } | null>(null)
	useFocusEffect(
		useCallback(() => {
			let active = true
			setResult(null)
			if (isLocalSongUrl(track.url))
				void getOfflineAvailability(track.url, revision).then((state) => {
					if (active && cacheRevisionStore.getValue() === revision)
						setResult({ url: track.url, state })
				})
			return () => {
				active = false
			}
		}, [track.url, revision]),
	)
	if (!isLocalSongUrl(track.url)) {
		if (!task) return null
		return (
			<Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 3 }}>
				{i18n.t(
					task.status === 'downloading'
						? 'cacheCenter.downloading'
						: `cacheCenter.status.${task.status}`,
					{ progress: Math.round(task.progress * 100) },
				)}
			</Text>
		)
	}
	const state = result?.url === track.url ? result?.state : null
	const label =
		state === 'available'
			? track.cacheKind === 'automatic'
				? 'offline.cached'
				: track.platform === 'local'
					? 'offline.local'
					: 'offline.saved'
			: state === 'missing'
				? 'offline.missing'
				: state === 'unknown'
					? 'offline.unknown'
					: 'offline.checking'
	return (
		<Text
			accessibilityLiveRegion="polite"
			style={{
				color:
					state === 'missing'
						? colors.error
						: state === 'available'
							? colors.success
							: colors.textMuted,
				fontSize: 11,
				marginTop: 3,
			}}
		>
			{i18n.t(label)}
		</Text>
	)
}
