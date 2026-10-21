import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useIsPlaying } from '@rntp/player'
import myTrackPlayer, { recentlyPlayedStore } from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { formatSecondsToMinutes } from '@/helpers/miscellaneous'
import { showToast } from '@/utils/utils'
import i18n from '@/utils/i18n'

export default function ContinueListening() {
	const colors = useThemeColors()
	const current = myTrackPlayer.useCurrentMusic()
	const saved = PersistStatus.useValue('music.musicItem')
	const recent = recentlyPlayedStore.useValue()
	const queue = myTrackPlayer.usePlayList()
	const savedQueue = PersistStatus.useValue('music.play-list', [])
	const storedPosition = PersistStatus.useValue('music.progress', 0) ?? 0
	const live = myTrackPlayer.useProgress(1)
	const playing = useIsPlaying()
	const [busy, setBusy] = useState(false)
	const pending = useRef(false)
	const track = current ?? saved ?? recent?.[0]
	if (!track) return null
	const position = current ? live.position : saved ? storedPosition : 0
	const count = queue.length || savedQueue?.length || 1
	const resume = async () => {
		if (pending.current) return
		pending.current = true
		setBusy(true)
		router.navigate('/player')
		try {
			if (!(await myTrackPlayer.continueLastSession()))
				showToast(i18n.t('continueListening.failed'), '', 'error')
		} catch {
			showToast(i18n.t('continueListening.failed'), '', 'error')
		} finally {
			pending.current = false
			setBusy(false)
		}
	}
	return (
		<View
			style={{
				backgroundColor: colors.surfaceElevated,
				borderRadius: 16,
				padding: 16,
				marginTop: 12,
				gap: 8,
			}}
		>
			<Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
				{i18n.t('continueListening.title')}
			</Text>
			<Text numberOfLines={1} style={{ color: colors.text, fontSize: 16 }}>
				{track.title}
			</Text>
			<Text numberOfLines={1} style={{ color: colors.textMuted }}>
				{track.artist}
			</Text>
			<Text style={{ color: colors.textMuted, fontSize: 12 }}>
				{i18n.t('continueListening.context', {
					count,
					position: formatSecondsToMinutes(
						Number.isFinite(position) && position > 0 ? position : 0,
					),
				})}
			</Text>
			<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
				<Pressable
					accessibilityRole="button"
					disabled={busy}
					accessibilityState={{ busy, disabled: busy }}
					onPress={() => void resume()}
					style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 }}
				>
					<Ionicons name={playing ? 'musical-note' : 'play'} size={18} color={colors.primary} />
					<Text style={{ color: colors.primary }}>
						{i18n.t(playing ? 'continueListening.open' : 'continueListening.resume')}
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					onPress={() => {
						try {
							if (!myTrackPlayer.getPlayList().length) {
								const retainedQueue = PersistStatus.get('music.play-list') ?? []
								if (retainedQueue.length) myTrackPlayer.addAll(retainedQueue)
							}
							router.push('/(modals)/playList')
						} catch {
							showToast(i18n.t('continueListening.failed'), '', 'error')
						}
					}}
					style={{ minHeight: 44, justifyContent: 'center' }}
				>
					<Text style={{ color: colors.primary }}>{i18n.t('continueListening.queue')}</Text>
				</Pressable>
			</View>
		</View>
	)
}
