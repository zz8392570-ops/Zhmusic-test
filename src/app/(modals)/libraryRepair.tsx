import { useEffect, useRef, useState } from 'react'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { useThemeColors } from '@/hooks/useAppTheme'
import { repairUnavailableTracks, type LibraryRepairResult } from '@/helpers/libraryRepair'
import { applyLibraryRepair, getMaintenanceTarget } from '@/helpers/libraryMaintenance'
import { copyLibraryTracks } from '@/helpers/libraryEdits'
import { playListsStore, musicApiSelectedStore } from '@/player/PlayerStore'
import { useFavorites } from '@/store/library'
import i18n from '@/utils/i18n'

export default function LibraryRepairScreen() {
	const colors = useThemeColors(),
		{ target: initial } = useLocalSearchParams<{ target?: string }>()
	const { favorites } = useFavorites(),
		playlists = playListsStore.useValue() ?? []
	const [target, setTarget] = useState(initial || 'favorites')
	const [plan, setPlan] = useState<LibraryRepairResult | null>(null)
	const [baseline, setBaseline] = useState<IMusic.IMusicItem[]>([])
	const [selected, setSelected] = useState<Set<number>>(new Set())
	const [progress, setProgress] = useState<[number, number] | null>(null)
	const controller = useRef<AbortController | null>(null)
	useEffect(() => () => controller.current?.abort(), [])
	const run = async () => {
		if (controller.current) return
		if (!musicApiSelectedStore.getValue()) {
			Alert.alert(i18n.t('sourceErrors.noSource'))
			return
		}
		const owner = new AbortController()
		controller.current = owner
		try {
			const snapshot = copyLibraryTracks(getMaintenanceTarget(target).songs)
			setBaseline(snapshot)
			setPlan(null)
			setProgress([0, snapshot.length])
			const result = await repairUnavailableTracks(snapshot, {
				signal: owner.signal,
				onProgress: (done, total) => {
					if (!owner.signal.aborted) setProgress([done, total])
				},
			})
			if (!owner.signal.aborted) {
				setPlan(result)
				setSelected(new Set(result.replacements.map((_, index) => index)))
			}
		} catch {
			if (!owner.signal.aborted) Alert.alert(i18n.t('playlistTools.repairFailed'))
		} finally {
			if (controller.current === owner) {
				controller.current = null
				setProgress(null)
			}
		}
	}
	const apply = () => {
		if (!plan || !selected.size) return
		Alert.alert(
			i18n.t('maintenance.apply'),
			i18n.t('maintenance.confirm', { count: selected.size }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('common.confirm'),
					onPress: () => {
						try {
							const count = applyLibraryRepair(
								target,
								baseline,
								plan.replacements.filter((_, index) => selected.has(index)),
							)
							setPlan(null)
							Alert.alert(
								i18n.t('playlistTools.repairComplete'),
								i18n.t('maintenance.applied', { count }),
							)
						} catch {
							Alert.alert(i18n.t('playlistTools.repairFailed'))
						}
					},
				},
			],
		)
	}
	return (
		<FlatList
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20 }}
			data={plan?.replacements ?? []}
			keyExtractor={(_, index) => String(index)}
			ListHeaderComponent={
				<View style={{ gap: 8 }}>
					<Text style={{ color: colors.textMuted }}>{i18n.t('maintenance.description')}</Text>
					{[
						{ id: 'favorites', title: i18n.t('appTab.favoritesSongs'), count: favorites.length },
						...playlists.map((item) => ({
							id: item.id,
							title: item.title || item.name,
							count: item.songs.length,
						})),
					].map((item) => (
						<Button
							key={item.id}
							title={`${target === item.id ? '✓ ' : ''}${item.title} (${item.count})`}
							disabled={!!progress}
							onPress={() => {
								setTarget(item.id)
								setPlan(null)
							}}
						/>
					))}
					<Button
						title={
							progress
								? i18n.t('maintenance.progress', { checked: progress[0], total: progress[1] })
								: i18n.t('maintenance.scan')
						}
						disabled={!!progress}
						onPress={() => void run()}
					/>
					{progress ? (
						<Button
							title={i18n.t('find.cancel')}
							onPress={() => {
								controller.current?.abort()
								setPlan(null)
							}}
						/>
					) : null}
					{plan ? (
						<>
							<Text style={{ color: colors.text }}>
								{i18n.t('playlistTools.repairSummary', {
									unavailable: plan.unavailable,
									repaired: plan.repaired,
									review: plan.review.length,
								})}
							</Text>
							<Button
								title={i18n.t('maintenance.apply')}
								disabled={!selected.size}
								onPress={apply}
							/>
							<Button
								title={i18n.t('maintenance.toggleAll')}
								onPress={() =>
									setSelected(
										selected.size ? new Set() : new Set(plan.replacements.map((_, index) => index)),
									)
								}
							/>
							{plan.review.length ? (
								<Text style={{ color: colors.textMuted }}>
									{i18n.t('maintenance.unresolved')}
									{'\n'}
									{plan.review
										.slice(0, 20)
										.map((item) => `${item.title} · ${item.artist}`)
										.join('\n')}
								</Text>
							) : null}
						</>
					) : null}
				</View>
			}
			renderItem={({ item, index }) => (
				<Pressable
					accessibilityRole="checkbox"
					accessibilityState={{ checked: selected.has(index) }}
					onPress={() =>
						setSelected((old) => {
							const next = new Set(old)
							if (next.has(index)) next.delete(index)
							else next.add(index)
							return next
						})
					}
					style={{
						paddingVertical: 18,
						borderBottomWidth: 1,
						borderBottomColor: colors.surfaceMuted,
					}}
				>
					<Text style={{ color: colors.text }}>
						{selected.has(index) ? '☑' : '☐'} {item.original.title} · {item.original.artist}
					</Text>
					<Text style={{ color: colors.textMuted }}>
						{item.original.platform} → {item.replacement.platform} · {item.replacement.title} ·{' '}
						{item.replacement.artist}
					</Text>
				</Pressable>
			)}
		/>
	)
}
