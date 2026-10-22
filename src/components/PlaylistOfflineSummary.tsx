import { Text, View, Pressable } from 'react-native'
import { MenuView } from '@/components/ActionMenu'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { getDownloadQuality, getDownloadQualityActions } from '@/helpers/downloadQuality'
import { confirmPlaylistDownload } from '@/helpers/confirmPlaylistDownload'
import {
	scanPlaylistOffline,
	missingDownloadTracks,
	type PlaylistOfflineEntry,
} from '@/helpers/playlistOffline'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { showToast } from '@/utils/utils'
import type { Track } from '@/player/types'
import { useEffect, useRef } from 'react'

export function PlaylistOfflineSummary({
	tracks,
	entries,
	onlyOffline,
	onToggle,
}: {
	tracks: Track[]
	entries: PlaylistOfflineEntry[] | null
	onlyOffline: boolean
	onToggle: () => void
}) {
	const colors = useThemeColors()
	const currentTracks = useRef(tracks)
	currentTracks.current = tracks
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
		}
	}, [])
	const available = entries?.filter((entry) => entry.state === 'available').length ?? 0
	const missing = entries ? missingDownloadTracks(entries) : []
	const unknown = entries?.filter((entry) => entry.state === 'unknown').length ?? 0
	const buttonStyle = {
		paddingVertical: 12,
		paddingHorizontal: 14,
		borderRadius: 12,
		backgroundColor: colors.surfaceMuted,
	}
	return (
		<View style={{ gap: 6, marginTop: 14 }}>
			<Text
				accessibilityLiveRegion="polite"
				style={{ color: colors.textMuted, textAlign: 'center' }}
			>
				{entries
					? i18n.t('personalOffline.coverage', { total: tracks.length, available })
					: i18n.t('offline.checking')}
			</Text>
			{unknown > 0 && (
				<Text style={{ color: colors.textMuted, textAlign: 'center' }}>
					{i18n.t('personalOffline.unknown', { count: unknown })}
				</Text>
			)}
			<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
				<Pressable
					accessibilityRole="button"
					accessibilityState={{ selected: onlyOffline, disabled: !entries }}
					disabled={!entries}
					onPress={onToggle}
					style={buttonStyle}
				>
					<Text style={{ color: colors.primary }}>
						{i18n.t(onlyOffline ? 'personalOffline.showAll' : 'personalOffline.filter')}
					</Text>
				</Pressable>
				{missing.length > 0 && (
					<MenuView
						title={i18n.t('personalOffline.fill')}
						actions={getDownloadQualityActions()}
						onPressAction={({ nativeEvent: { event } }) => {
							const quality = getDownloadQuality(event)
							if (!quality || !entries) return
							// Recheck after confirmation: a completed parallel download must not be enqueued again.
							void confirmPlaylistDownload(missing, quality, async (_selected, options) => {
								if (!mounted.current || currentTracks.current !== tracks) return
								const fresh = await scanPlaylistOffline(tracks, new AbortController().signal)
								if (!mounted.current || currentTracks.current !== tracks || !fresh) return
								const selectedKeys = new Set(
									missing.map((track) => JSON.stringify([track.platform, track.id])),
								)
								const remaining = missingDownloadTracks(fresh).filter((track) =>
									selectedKeys.has(JSON.stringify([track.platform, track.id])),
								)
								if (remaining.length)
									await myTrackPlayer.downloadPlaylist(remaining as IMusic.IMusicItem[], options)
								else
									showToast(
										i18n.t(
											fresh.some((entry) => entry.state === 'unknown')
												? 'personalOffline.recheck'
												: 'personalOffline.complete',
										),
										'',
										'info',
									)
							})
						}}
					>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={i18n.t('personalOffline.fill')}
							style={buttonStyle}
						>
							<Text style={{ color: colors.primary }}>
								{i18n.t('personalOffline.fillCount', { count: missing.length })}
							</Text>
						</Pressable>
					</MenuView>
				)}
			</View>
			{onlyOffline && entries && !available && (
				<Text style={{ color: colors.textMuted, textAlign: 'center' }}>
					{i18n.t('personalOffline.empty')}
				</Text>
			)}
		</View>
	)
}
