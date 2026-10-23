import { useMemo } from 'react'
import { Text, View } from 'react-native'
import type { Track } from '@/player/types'
import { usePlaylistOffline } from '@/hooks/usePlaylistOffline'
import { formatVersionDuration, getVersionTitle } from '@/helpers/trackVersionInfo'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
export function TrackVersionDetails({ track }: { track: Track }) {
	const colors = useThemeColors()
	const tracks = useMemo(() => [track], [track])
	const entries = usePlaylistOffline(tracks, true)
	const state = entries?.[0]?.state
	const duration = formatVersionDuration(track.duration) ?? i18n.t('favoriteGroups.unknownDuration')
	const label =
		state === 'available'
			? 'versions.offlineAvailable'
			: state === 'missing'
				? 'offline.missing'
				: state === 'online'
					? 'versions.onlineOnly'
					: state === 'unknown'
						? 'offline.unknown'
						: 'offline.checking'
	return (
		<View style={{ gap: 4, marginTop: 6 }}>
			<Text style={{ color: colors.text }}>{getVersionTitle(track)}</Text>
			<Text style={{ color: colors.textMuted, fontSize: 12 }}>
				{track.album || i18n.t('versions.unknownAlbum')} · {duration}
			</Text>
			<Text
				accessibilityLiveRegion="polite"
				style={{ color: state === 'available' ? colors.success : colors.textMuted, fontSize: 12 }}
			>
				{i18n.t(label)}
			</Text>
		</View>
	)
}
