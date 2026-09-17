import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import {
	sourceLoadingProgressStore,
	sourceLoadingErrorStore,
	trackSourceLoadingStore,
} from '@/player/PlayerStore'
import i18n from '@/utils/i18n'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

export default function SourceLoadingStatus() {
	const colors = useThemeColors()
	const progress = sourceLoadingProgressStore.useValue()
	const error = sourceLoadingErrorStore.useValue()
	const loading = trackSourceLoadingStore.useValue() !== null
	if (!loading && !error) return null
	const action = (label: string, onPress: () => void) => (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}
		>
			<Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>{label}</Text>
		</Pressable>
	)
	return (
		<View
			style={{
				backgroundColor: colors.surfaceElevated,
				borderRadius: 12,
				paddingHorizontal: 12,
				paddingTop: 10,
			}}
			accessibilityLiveRegion="polite"
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
				{loading ? <ActivityIndicator color={colors.primary} size="small" /> : null}
				<Text style={{ color: colors.text, flex: 1, fontSize: 13 }}>
					{error ||
						i18n.t(`player.sourceLoading.${progress?.stage ?? 'resolving'}`, {
							source: progress?.sourceName || '',
							quality: progress?.quality || '',
						})}
				</Text>
			</View>
			<View style={{ flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
				{error ? action(i18n.t('find.retry'), () => void myTrackPlayer.play(null, true)) : null}
				{action(
					i18n.t('player.sourceLoading.switch'),
					() => void myTrackPlayer.retryWithNextSource(),
				)}
				{action(i18n.t('player.sourceLoading.next'), () => void myTrackPlayer.skipToNext())}
				{loading ? action(i18n.t('find.cancel'), myTrackPlayer.cancelSourceLoading) : null}
			</View>
		</View>
	)
}
