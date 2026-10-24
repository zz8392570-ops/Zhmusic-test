import { tagSelectedSongs, renameLibraryTag, saveTagCollection } from '@/helpers/personalTagActions'
import { getLibraryTrackKey } from '@/helpers/libraryEdits'
import { filterTaggedTracks } from '@/helpers/personalFeatures'
import { useEffect, useMemo, useState } from 'react'
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
			collection?: string
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
	const collections = PersistStatus.useValue('music.tagCollections', []) ?? []
	const collection = collections.find((item) => item.id === params.collection)
	const [selecting, setSelecting] = useState(false)
	const [selection, setSelection] = useState<Set<string>>(new Set())
	const [editText, setEditText] = useState('')
	useEffect(() => {
		setSelection(new Set())
	}, [selected, matchAll])
	const [editMode, setEditMode] = useState<'batch' | 'rename' | 'save' | null>(null)
	useEffect(() => {
		if (collection) {
			setSelected(collection.tags)
			setMatchAll(collection.matchAll)
		}
	}, [collection])
	const filtered = useMemo(
		() => filterTaggedTracks(tracks, tags, favorites, selected, matchAll),
		[tracks, tags, favorites, selected, matchAll],
	)
	const performEdit = () => {
		try {
			if (editMode === 'batch')
				tagSelectedSongs(selection, normalizeTags(editText.split(/[、,，\n]+/)))
			else if (editMode === 'rename' && selected.length === 1) {
				renameLibraryTag(selected[0], editText)
				setSelected(normalizeTags([editText]))
			} else if (editMode === 'save') saveTagCollection(editText, selected, matchAll)
			else throw Error()
			setEditMode(null)
			setEditText('')
			setSelection(new Set())
			setSelecting(false)
			showToast(i18n.t('personalFeatures.saved'), '', 'success')
		} catch {
			Alert.alert(i18n.t('personalFeatures.tagFailed'))
		}
	}
	const beginEdit = (mode: 'batch' | 'rename' | 'save') => {
		setEditText(mode === 'rename' ? selected[0] ?? '' : '')
		setEditMode(mode)
	}

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
						name: collection?.name ?? i18n.t('personalFeatures.tags'),
						title: collection?.name ?? i18n.t('personalFeatures.tags'),
						tracks: [],
					} as any
				}
				tracks={params.collection && !collection ? [] : filtered}
				isMultiSelectMode={selecting}
				selectedTracks={selection}
				toggleMultiSelectMode={() => {
					setSelecting((value) => !value)
					setSelection(new Set())
				}}
				onToggleSelection={(key) =>
					setSelection((previous) => {
						const next = new Set(previous)
						if (next.has(key)) next.delete(key)
						else next.add(key)
						return next
					})
				}
				onSelectAll={() =>
					setSelection((previous) =>
						filtered.every((track) => previous.has(getLibraryTrackKey(track)))
							? new Set()
							: new Set(filtered.map(getLibraryTrackKey)),
					)
				}
				compactHeader
				headerContent={
					<View>
						<Text style={{ color: colors.textMuted }}>
							{i18n.t('personalFeatures.tagBrowseHint')}
						</Text>
						{chips}
						{params.collection && !collection && (
							<Text style={{ color: colors.error }}>
								{i18n.t('personalFeatures.collectionGone')}
							</Text>
						)}
						<Button
							title={i18n.t(selecting ? 'find.cancel' : 'personalRefinement.batchTags')}
							onPress={() => {
								setSelecting(!selecting)
								setSelection(new Set())
							}}
						/>
						{selecting && (
							<Button
								disabled={!selection.size}
								title={i18n.t('personalRefinement.applyTags', { count: selection.size })}
								onPress={() => beginEdit('batch')}
							/>
						)}
						<Button
							disabled={selected.length !== 1}
							title={i18n.t('personalRefinement.renameTag')}
							onPress={() => beginEdit('rename')}
						/>
						<Button
							disabled={!selected.length || collections.length >= 20}
							title={i18n.t('personalRefinement.saveFilter')}
							onPress={() => beginEdit('save')}
						/>
						{editMode && (
							<View style={{ gap: 8 }}>
								<Text style={{ color: colors.textMuted }}>
									{i18n.t(`personalRefinement.${editMode}Hint`)}
								</Text>
								<TextInput
									accessibilityLabel={i18n.t('personalFeatures.name')}
									value={editText}
									onChangeText={setEditText}
									maxLength={editMode === 'batch' ? 600 : editMode === 'rename' ? 32 : 40}
									style={{ padding: 14, color: colors.text, backgroundColor: colors.surfaceMuted }}
								/>
								<Button title={i18n.t('personalFeatures.save')} onPress={performEdit} />
								<Button title={i18n.t('find.cancel')} onPress={() => setEditMode(null)} />
							</View>
						)}
						{collection && (
							<Button
								danger
								title={i18n.t('personalRefinement.deleteFilter')}
								onPress={() =>
									Alert.alert(i18n.t('personalRefinement.deleteFilter'), collection.name, [
										{ text: i18n.t('find.cancel'), style: 'cancel' },
										{
											text: i18n.t('common.delete'),
											style: 'destructive',
											onPress: () => {
												try {
													PersistStatus.set(
														'music.tagCollections',
														(PersistStatus.get('music.tagCollections') ?? []).filter(
															(item) => item.id !== collection.id,
														),
													)
												} catch {
													Alert.alert(i18n.t('personalFeatures.tagFailed'))
												}
											},
										},
									])
								}
							/>
						)}
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
