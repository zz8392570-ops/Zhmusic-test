import { getRecycleEntries, restoreRecycleEntry } from '@/helpers/libraryRecycle'
import { playListsStore } from '@/helpers/trackPlayerIndex'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { FlashList } from '@shopify/flash-list'
import { Alert, Pressable, Text, View } from 'react-native'

export default function RecycleBinScreen() {
	const colors = useThemeColors()
	PersistStatus.useValue('library.recycleBin', [])
	const entries = getRecycleEntries()
	const restore = (id: string) => {
		try {
			playListsStore.setValue(restoreRecycleEntry(id, playListsStore.getValue() ?? []))
		} catch {
			Alert.alert(i18n.t('recycleBin.failed'))
		}
	}
	return (
		<FlashList
			data={entries}
			keyExtractor={(item) => item.id}
			contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
			style={{ flex: 1, backgroundColor: colors.background }}
			ListHeaderComponent={
				<View style={{ gap: 12, marginBottom: 16 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('recycleBin.description')}</Text>
					{entries.length ? (
						<View style={{ flexDirection: 'row', gap: 24 }}>
							<Pressable
								accessibilityRole="button"
								onPress={() => restore(entries[0].id)}
								style={{ paddingVertical: 12 }}
							>
								<Text style={{ color: colors.primary }}>{i18n.t('recycleBin.undo')}</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								onPress={() =>
									Alert.alert(i18n.t('recycleBin.emptyTitle'), i18n.t('recycleBin.emptyConfirm'), [
										{ text: i18n.t('find.cancel'), style: 'cancel' },
										{
											text: i18n.t('playlistTools.delete'),
											style: 'destructive',
											onPress: () => {
												try {
													PersistStatus.set('library.recycleBin', [])
												} catch {
													Alert.alert(i18n.t('recycleBin.failed'))
												}
											},
										},
									])
								}
								style={{ paddingVertical: 12 }}
							>
								<Text style={{ color: colors.error }}>{i18n.t('recycleBin.emptyTitle')}</Text>
							</Pressable>
						</View>
					) : null}
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('recycleBin.empty')}</Text>
			}
			renderItem={({ item }) => (
				<View
					style={{
						paddingVertical: 14,
						borderBottomWidth: 0.5,
						borderColor: colors.separator,
						flexDirection: 'row',
						alignItems: 'center',
						gap: 12,
					}}
				>
					<View style={{ flex: 1 }}>
						<Text style={{ color: colors.text, fontSize: 16 }}>{item.playlist.name}</Text>
						<Text style={{ color: colors.textMuted, marginTop: 6 }}>
							{i18n.t(item.kind === 'playlist' ? 'recycleBin.playlist' : 'recycleBin.songs', {
								count: item.playlist.songs.length,
							})}{' '}
							· {new Date(item.deletedAt).toLocaleDateString()}
						</Text>
					</View>
					<Pressable
						accessibilityRole="button"
						onPress={() => restore(item.id)}
						style={{ padding: 12 }}
					>
						<Text style={{ color: colors.primary }}>{i18n.t('recycleBin.restore')}</Text>
					</Pressable>
				</View>
			)}
		/>
	)
}
