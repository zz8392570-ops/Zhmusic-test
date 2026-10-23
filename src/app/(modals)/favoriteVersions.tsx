import { TrackVersionDetails } from '@/components/TrackVersionDetails'
import { showToast } from '@/utils/utils'
import { Alert, FlatList, Text, View } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { useFavorites } from '@/store/library'
import { getFavoriteVariants, isFavoriteTrack } from '@/helpers/favoriteGroups'
import {
	preferFavoriteSource,
	removeFavoriteVariant,
	splitFavoriteGroup,
} from '@/helpers/favoriteGroupActions'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import { useThemeColors } from '@/hooks/useAppTheme'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import i18n from '@/utils/i18n'
import type { Track } from '@/player/types'
export default function FavoriteVersionsScreen() {
	const colors = useThemeColors(),
		{ favorites } = useFavorites()
	const { id, platform } = useLocalSearchParams<{ id?: string; platform?: string }>()
	const groups = favorites.filter((item) =>
		id ? isFavoriteTrack(item, { id, platform }) : getFavoriteVariants(item).length > 1,
	)
	const perform = (action: () => unknown, success?: string) => {
		try {
			const result = action()
			if (result === false || (success && !result)) Alert.alert(i18n.t('versions.changed'))
			else if (success) showToast(i18n.t(success), '', 'success')
		} catch {
			Alert.alert(i18n.t('favoriteGroups.failed'))
		}
	}
	const remove = (group: Track, version: Track) =>
		Alert.alert(
			i18n.t('versions.remove'),
			i18n.t('versions.confirmRemove', { title: version.title }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('common.confirm'),
					style: 'destructive',
					onPress: () => perform(() => removeFavoriteVariant(group, version)),
				},
			],
		)
	return (
		<FlatList
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20 }}
			data={groups}
			keyExtractor={(item) => JSON.stringify([item.platform, item.id])}
			ListHeaderComponent={
				<View>
					<Text style={{ color: colors.textMuted }}>{i18n.t('versions.description')}</Text>
					<Button
						title={i18n.t('history.title')}
						onPress={() => router.push('/(modals)/libraryHistory')}
					/>
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('favoriteGroups.empty')}</Text>
			}
			renderItem={({ item }) => (
				<View style={{ marginVertical: 18, gap: 8 }}>
					<Text style={{ color: colors.text, fontSize: 20 }}>
						{item.title} · {item.artist}
					</Text>
					{getFavoriteVariants(item).map((version) => (
						<View
							key={JSON.stringify([version.platform, version.id])}
							style={{ padding: 12, backgroundColor: colors.surfaceMuted, borderRadius: 12 }}
						>
							<Text style={{ color: colors.text }}>
								{i18n.t(getMusicPlatformLabelKey(version.platform) || 'versions.unknown')}
							</Text>
							<TrackVersionDetails track={version} />
							<Button
								title={i18n.t(
									version.platform === item.platform && version.id === item.id
										? 'versions.default'
										: 'versions.setDefault',
								)}
								disabled={version.platform === item.platform && version.id === item.id}
								onPress={() =>
									perform(() => preferFavoriteSource(item, version), 'versions.defaultSaved')
								}
							/>
							<Button
								title={i18n.t('versions.remove')}
								danger
								disabled={getFavoriteVariants(item).length < 2}
								onPress={() => remove(item, version)}
							/>
						</View>
					))}
					<Button
						title={i18n.t('favoriteGroups.split')}
						disabled={getFavoriteVariants(item).length < 2}
						onPress={() => perform(() => splitFavoriteGroup(item))}
					/>
				</View>
			)}
		/>
	)
}
