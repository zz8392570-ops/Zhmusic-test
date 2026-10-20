import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { normalizePlayLaterState } from '@/player/PlayLaterQueue'
import { createDislikeMatcher, normalizeDislikeRules } from '@/helpers/dislikeRules'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import i18n from '@/utils/i18n'

export default function PlayLaterScreen() {
	const colors = useThemeColors()
	const state = normalizePlayLaterState(PersistStatus.useValue('music.playLater'))
	const disliked = createDislikeMatcher(
		normalizeDislikeRules(PersistStatus.useValue('music.dislikeRules', [])),
	)
	const perform = async (action: () => unknown) => {
		try {
			await action()
		} catch {
			Alert.alert(i18n.t('playLater.failed'))
		}
	}
	const clear = () =>
		Alert.alert(i18n.t('playLater.clear'), i18n.t('playLater.confirmClear'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('common.confirm'),
				style: 'destructive',
				onPress: () => void perform(() => myTrackPlayer.clearPlayLater()),
			},
		])
	return (
		<FlatList
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20 }}
			data={state.pending}
			keyExtractor={(entry) => entry.id}
			ListHeaderComponent={
				<View style={{ gap: 8, marginBottom: 16 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('playLater.description')}</Text>
					{state.active ? (
						<Text style={{ color: colors.primary }}>
							{i18n.t('playLater.playing', { title: state.active.track.title })}
						</Text>
					) : null}
					<Button
						title={i18n.t('playLater.clear')}
						disabled={!state.pending.length}
						danger
						onPress={clear}
					/>
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('playLater.empty')}</Text>
			}
			renderItem={({ item, index }) => (
				<View style={{ paddingVertical: 12, gap: 6 }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={i18n.t('playLater.playNow', { title: item.track.title })}
						onPress={() => void perform(() => myTrackPlayer.playLaterNow(item.id))}
						style={{ minHeight: 48, justifyContent: 'center' }}
					>
						<Text style={{ color: colors.text, fontSize: 18 }}>{item.track.title}</Text>
						<Text style={{ color: colors.textMuted }}>{item.track.artist}</Text>
					</Pressable>
					{disliked(item.track) ? (
						<Text style={{ color: colors.textMuted }}>{i18n.t('playLater.disliked')}</Text>
					) : null}
					<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
						<Button
							title={i18n.t('queue.moveUp')}
							disabled={index === 0}
							onPress={() => void perform(() => myTrackPlayer.movePlayLater(index, index - 1))}
						/>
						<Button
							title={i18n.t('queue.moveDown')}
							disabled={index === state.pending.length - 1}
							onPress={() => void perform(() => myTrackPlayer.movePlayLater(index, index + 1))}
						/>
						<Button
							title={i18n.t('queue.remove')}
							danger
							onPress={() => void perform(() => myTrackPlayer.removePlayLater(item.id))}
						/>
					</View>
				</View>
			)}
		/>
	)
}
