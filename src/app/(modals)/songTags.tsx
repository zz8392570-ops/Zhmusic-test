import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useFavorites } from '@/store/library'
import PersistStatus from '@/store/PersistStatus'
import { importedLocalMusicStore, playListsStore } from '@/player/PlayerStore'
import {
	getTrackTags,
	normalizeTags,
	personalTracks,
	updateTrackTags,
} from '@/helpers/personalFeatures'
import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { showToast } from '@/utils/utils'
export default function SongTagsScreen() {
	const colors = useThemeColors(),
		{ favorites } = useFavorites(),
		playlists = playListsStore.useValue(),
		local = importedLocalMusicStore.useValue()
	const storedTags = PersistStatus.useValue('music.trackTags'),
		tags = useMemo(() => storedTags ?? {}, [storedTags]),
		params = useLocalSearchParams<{
			id?: string
			platform?: string
			originalId?: string
			title?: string
		}>()
	const track =
		params.id && params.platform
			? { id: params.id, platform: params.platform, originalId: params.originalId || undefined }
			: null
	const [input, setInput] = useState(() =>
			track ? getTrackTags(track, tags, favorites).join('、') : '',
		),
		[selected, setSelected] = useState<string[]>([]),
		[matchAll, setMatchAll] = useState(true)
	const tracks = useMemo(
		() => personalTracks(favorites, playlists ?? [], local ?? []),
		[favorites, playlists, local],
	)
	const allTags = useMemo(
		() => normalizeTags(tracks.flatMap((item) => getTrackTags(item, tags, favorites))).sort(),
		[tracks, tags, favorites],
	)
	const filtered = useMemo(
		() =>
			tracks.filter((item) => {
				const labels = getTrackTags(item, tags, favorites).map((tag) => tag.toLocaleLowerCase())
				return (
					!selected.length ||
					(matchAll
						? selected.every((tag) => labels.includes(tag.toLocaleLowerCase()))
						: selected.some((tag) => labels.includes(tag.toLocaleLowerCase())))
				)
			}),
		[tracks, tags, favorites, selected, matchAll],
	)
	const chips = (
		<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
			{allTags.map((tag) => (
				<Pressable
					key={tag}
					accessibilityRole="button"
					accessibilityState={{
						selected: selected.some(
							(value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase(),
						),
					}}
					onPress={() =>
						setSelected((values) =>
							values.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())
								? values.filter((value) => value.toLocaleLowerCase() !== tag.toLocaleLowerCase())
								: [...values, tag],
						)
					}
					style={{
						padding: 12,
						borderRadius: 12,
						backgroundColor: selected.some(
							(value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase(),
						)
							? colors.primary
							: colors.surfaceMuted,
					}}
				>
					<Text
						style={{
							color: selected.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())
								? '#fff'
								: colors.text,
						}}
					>
						{tag}
					</Text>
				</Pressable>
			))}
		</View>
	)
	if (track)
		return (
			<ScrollView
				keyboardShouldPersistTaps="handled"
				automaticallyAdjustKeyboardInsets
				style={{ backgroundColor: colors.background }}
				contentContainerStyle={{ padding: 18, gap: 12 }}
			>
				<Text style={{ color: colors.text, fontSize: 20 }}>{params.title ?? ''}</Text>
				<Text style={{ color: colors.textMuted }}>{i18n.t('personalFeatures.tagHint')}</Text>
				<TextInput
					value={input}
					maxLength={600}
					accessibilityLabel={i18n.t('personalFeatures.tags')}
					onChangeText={setInput}
					multiline
					style={{
						backgroundColor: colors.surfaceMuted,
						color: colors.text,
						minHeight: 90,
						borderRadius: 12,
						padding: 14,
					}}
				/>
				<Button
					title={i18n.t('personalFeatures.save')}
					onPress={() => {
						try {
							const values = normalizeTags(input.split(/[、,，\n]+/))
							PersistStatus.set(
								'music.trackTags',
								updateTrackTags(
									track,
									PersistStatus.get('music.trackTags') ?? {},
									values,
									PersistStatus.get('music.favorites') ?? [],
								),
							)
							setInput(values.join('、'))
							showToast(i18n.t('personalFeatures.saved'), '', 'success')
						} catch {
							Alert.alert(i18n.t('personalFeatures.tagFailed'))
						}
					}}
				/>
			</ScrollView>
		)
	return (
		<View style={{ flex: 1, backgroundColor: colors.background }}>
			<PlaylistTracksList
				playlist={
					{
						id: 'tag-filter',
						name: i18n.t('personalFeatures.tags'),
						title: i18n.t('personalFeatures.tags'),
						tracks: [],
					} as any
				}
				tracks={filtered}
				compactHeader
				headerContent={
					<View>
						<Text style={{ color: colors.textMuted }}>
							{i18n.t('personalFeatures.tagBrowseHint')}
						</Text>
						{chips}
						<Button
							title={i18n.t(matchAll ? 'personalFeatures.matchAll' : 'personalFeatures.matchAny')}
							onPress={() => setMatchAll((value) => !value)}
						/>
						<Button
							title={i18n.t('personalFeatures.clearFilter')}
							onPress={() => setSelected([])}
						/>
					</View>
				}
			/>
		</View>
	)
}
