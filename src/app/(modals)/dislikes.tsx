import { Alert, FlatList, Text, View } from 'react-native'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { normalizeDislikeRules } from '@/helpers/dislikeRules'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import i18n from '@/utils/i18n'

export default function DislikesScreen() {
	const colors = useThemeColors()
	const rules = normalizeDislikeRules(PersistStatus.useValue('music.dislikeRules', []))
	const perform = (action: () => unknown) => {
		try {
			action()
		} catch {
			Alert.alert(i18n.t('dislikes.failed'))
		}
	}
	const clear = () =>
		Alert.alert(i18n.t('dislikes.clear'), i18n.t('dislikes.confirmClear'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('common.confirm'),
				style: 'destructive',
				onPress: () => perform(() => myTrackPlayer.clearDislikeRules()),
			},
		])
	return (
		<FlatList
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20 }}
			data={rules}
			keyExtractor={(rule) => rule.id}
			ListHeaderComponent={
				<View style={{ gap: 8, marginBottom: 16 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('dislikes.description')}</Text>
					<Text style={{ color: colors.textMuted }}>{i18n.t('dislikes.hint')}</Text>
					<Button
						title={i18n.t('dislikes.clear')}
						disabled={!rules.length}
						danger
						onPress={clear}
					/>
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('dislikes.empty')}</Text>
			}
			renderItem={({ item }) => (
				<View style={{ paddingVertical: 12, gap: 6 }}>
					<Text style={{ color: colors.text, fontSize: 18 }}>
						{item.kind === 'song' ? item.title : item.artist}
					</Text>
					<Text style={{ color: colors.textMuted }}>
						{item.kind === 'song' ? item.artist : i18n.t('dislikes.artistRule')}
					</Text>
					<Button
						title={i18n.t('dislikes.remove')}
						onPress={() => perform(() => myTrackPlayer.removeDislikeRule(item.id))}
					/>
				</View>
			)}
		/>
	)
}
