import { ScrollView, Text } from 'react-native'
import { router } from 'expo-router'
import { MenuView } from '@/components/ActionMenu'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
export default function PersonalToolsScreen() {
	const colors = useThemeColors(),
		playlists = PersistStatus.useValue('music.playLists', []) ?? [],
		selected = PersistStatus.useValue('widget.collectionId', 'favorites') ?? 'favorites'
	const collections = [
		{ id: 'favorites', name: i18n.t('appTab.favoritesSongs') },
		...playlists.map((item) => ({ id: item.id, name: item.name })),
	]
	return (
		<ScrollView
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 18, gap: 12 }}
		>
			<Button
				title={i18n.t('personalFeatures.scenes')}
				onPress={() => router.push('/(modals)/listeningScenes' as any)}
			/>
			<Button
				title={i18n.t('personalFeatures.travel')}
				onPress={() => router.push('/(modals)/travelPack' as any)}
			/>
			<Button
				title={i18n.t('personalFeatures.tags')}
				onPress={() => router.push('/(modals)/songTags' as any)}
			/>
			<Text style={{ color: colors.text, fontSize: 20, marginTop: 12 }}>
				{i18n.t('personalFeatures.widget')}
			</Text>
			<Text style={{ color: colors.textMuted }}>{i18n.t('personalFeatures.widgetHint')}</Text>
			<MenuView
				actions={collections.map((item) => ({
					id: item.id,
					title: item.name,
					state: item.id === selected ? 'on' : 'off',
				}))}
				onPressAction={({ nativeEvent: { event } }) => {
					if (collections.some((item) => item.id === event))
						PersistStatus.set('widget.collectionId', event)
				}}
			>
				<Button
					title={i18n.t('personalFeatures.widgetCollection', {
						title: collections.find((item) => item.id === selected)?.name ?? collections[0].name,
					})}
					onPress={() => {}}
				/>
			</MenuView>
			<Text style={{ color: colors.textMuted }}>{i18n.t('personalFeatures.shortcutsHint')}</Text>
		</ScrollView>
	)
}
