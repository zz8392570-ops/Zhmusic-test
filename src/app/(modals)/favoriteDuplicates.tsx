import { useMemo, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useFavorites } from '@/store/library'
import {
	getFavoriteMergeCandidates,
	getFavoriteVariants,
	type FavoriteMergeCandidate,
} from '@/helpers/favoriteGroups'
import {
	mergeSelectedFavorites,
	splitFavoriteGroup,
	undoFavoriteMerge,
} from '@/helpers/favoriteGroupActions'
import { copyLibraryTracks } from '@/helpers/libraryEdits'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import type { Track } from '@/player/types'

type ReviewRow =
	| { kind: 'candidate'; id: string; group: FavoriteMergeCandidate }
	| { kind: 'merged'; id: string; track: Track }
export default function FavoriteDuplicatesScreen() {
	const colors = useThemeColors()
	const { favorites } = useFavorites()
	const [excluded, setExcluded] = useState<Set<string>>(new Set())
	const candidates = useMemo(() => getFavoriteMergeCandidates(favorites), [favorites])
	const selected = candidates.filter((group) => !group.review && !excluded.has(group.id))
	const rows: ReviewRow[] = [
		...candidates.map((group) => ({ kind: 'candidate' as const, id: group.id, group })),
		...favorites
			.filter((track) => getFavoriteVariants(track).length > 1)
			.map((track) => ({
				kind: 'merged' as const,
				id: `merged:${JSON.stringify([track.platform, track.id])}`,
				track,
			})),
	]
	const platform = (track: Track) => {
		const label = getMusicPlatformLabelKey(track.platform)
		return label ? i18n.t(label) : track.platform
	}
	const failed = () => Alert.alert(i18n.t('favoriteGroups.failed'))
	const apply = () => {
		const baseline = copyLibraryTracks(favorites)
		const ids = new Set(selected.map((group) => group.id))
		Alert.alert(
			i18n.t('favoriteGroups.confirmTitle'),
			i18n.t('favoriteGroups.confirm', { count: ids.size }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('common.confirm'),
					onPress: () => {
						try {
							const count = mergeSelectedFavorites(baseline, ids)
							Alert.alert(i18n.t('favoriteGroups.complete', { count }))
						} catch {
							failed()
						}
					},
				},
			],
		)
	}
	return (
		<FlashList
			style={{ flex: 1, backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, paddingBottom: 50 }}
			data={rows}
			keyExtractor={(item) => item.id}
			ListHeaderComponent={
				<View style={{ gap: 14, marginBottom: 16 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('favoriteGroups.description')}</Text>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ disabled: selected.length === 0 }}
						disabled={!selected.length}
						onPress={apply}
						style={{ paddingVertical: 14 }}
					>
						<Text style={{ color: selected.length ? colors.primary : colors.textMuted }}>
							{i18n.t('favoriteGroups.mergeSelected', { count: selected.length })}
						</Text>
					</Pressable>
					<Pressable
						accessibilityRole="button"
						onPress={() => {
							try {
								if (!undoFavoriteMerge()) Alert.alert(i18n.t('favoriteGroups.undoUnavailable'))
							} catch {
								failed()
							}
						}}
						style={{ paddingVertical: 12 }}
					>
						<Text style={{ color: colors.primary }}>{i18n.t('favoriteGroups.undo')}</Text>
					</Pressable>
				</View>
			}
			ListEmptyComponent={
				<Text style={{ color: colors.textMuted }}>{i18n.t('favoriteGroups.empty')}</Text>
			}
			renderItem={({ item }) => {
				if (item.kind === 'merged')
					return (
						<View
							style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 }}
						>
							<View style={{ flex: 1, gap: 6 }}>
								<Text style={{ color: colors.textMuted }}>{i18n.t('favoriteGroups.merged')}</Text>
								<Text style={{ color: colors.text }}>
									{item.track.title} · {getFavoriteVariants(item.track).map(platform).join(' · ')}
								</Text>
							</View>
							<Pressable
								accessibilityRole="button"
								onPress={() => {
									try {
										splitFavoriteGroup(item.track)
									} catch {
										failed()
									}
								}}
								style={{ padding: 12 }}
							>
								<Text style={{ color: colors.primary }}>{i18n.t('favoriteGroups.split')}</Text>
							</Pressable>
						</View>
					)
				const group = item.group
				return (
					<Pressable
						accessibilityRole={group.review ? undefined : 'checkbox'}
						accessibilityState={{
							checked: !group.review && !excluded.has(group.id),
							disabled: group.review,
						}}
						disabled={group.review}
						onPress={() =>
							setExcluded((previous) => {
								const next = new Set(previous)
								if (next.has(group.id)) next.delete(group.id)
								else next.add(group.id)
								return next
							})
						}
						style={{
							paddingVertical: 18,
							borderTopWidth: 0.5,
							borderColor: colors.separator,
							gap: 8,
						}}
					>
						<Text style={{ color: colors.text, fontSize: 17 }}>
							{group.review ? '?' : excluded.has(group.id) ? '☐' : '☑'} {group.tracks[0].title}
						</Text>
						<Text style={{ color: colors.textMuted }}>{group.tracks[0].artist}</Text>
						<Text style={{ color: colors.textMuted }}>
							{group.tracks
								.map(
									(track) =>
										`${platform(track)} · ${track.duration ? `${track.duration}s` : i18n.t('favoriteGroups.unknownDuration')}`,
								)
								.join('\n')}
						</Text>
						{group.review ? (
							<Text style={{ color: colors.textMuted }}>{i18n.t('favoriteGroups.review')}</Text>
						) : null}
					</Pressable>
				)
			}}
		/>
	)
}
