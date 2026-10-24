import { prepareTravelPack } from '@/helpers/travelPackActions'
import { releaseOfflineAssets } from '@/helpers/offlineAssets'
import { cacheDownloadTasksStore } from '@/player/PlayerStore'
import { personalTrackKey } from '@/helpers/personalFeatures'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router'
import { MenuView } from '@/components/ActionMenu'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import PersistStatus from '@/store/PersistStatus'
import { getListeningCollection } from '@/helpers/listeningSceneActions'
import {
	inspectTravelCollection,
	prepareTravelMetadata,
	type TravelEntry,
} from '@/helpers/travelPreparation'
import { confirmPlaylistDownload } from '@/helpers/confirmPlaylistDownload'
import { getDownloadQuality, getDownloadQualityActions } from '@/helpers/downloadQuality'
import { downloadPlaylist } from '@/player/DownloadManager'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
export default function TravelPackScreen() {
	const colors = useThemeColors(),
		params = useLocalSearchParams<{ id?: string }>()
	const [id, setId] = useState(params.id || 'favorites'),
		[entries, setEntries] = useState<TravelEntry[] | null>(null),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState('')
	const playlists = PersistStatus.useValue('music.playLists', []) ?? [],
		dynamic = PersistStatus.useValue('music.tagCollections', []) ?? [],
		owner = useRef<AbortController | null>(null),
		mounted = useRef(true),
		selection = useRef(id)
	const tasks = cacheDownloadTasksStore.useValue() ?? []
	const [quality, setQuality] = useState<IMusic.IQualityKey>('320k')
	const [visibleRows, setVisibleRows] = useState(50)
	const offline = PersistStatus.useValue('music.offlinePlayback', false)
	const inspectAgain = useRef<() => Promise<unknown>>(async () => {})
	const inspectedTasks = useRef<string | null>(null)
	const previewOpen = useRef(false)
	const focused = useRef(true)
	selection.current = id
	useFocusEffect(
		useCallback(() => {
			focused.current = true
			return () => {
				focused.current = false
				owner.current?.abort()
			}
		}, []),
	)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			owner.current?.abort()
		}
	}, [])
	useEffect(() => {
		owner.current?.abort()
		setEntries(null)
		setStatus('')
		inspectedTasks.current = null
	}, [id])
	const active = (controller: AbortController) =>
		mounted.current && focused.current && !controller.signal.aborted && selection.current === id
	const inspect = async () => {
		if (owner.current || !focused.current) return
		const tracks = getListeningCollection(id)
		if (!tracks) {
			Alert.alert(i18n.t('personalFeatures.collectionGone'))
			return
		}
		const controller = new AbortController()
		owner.current = controller
		setBusy(true)
		setEntries(null)
		try {
			const rows = await inspectTravelCollection(tracks, controller.signal, (values) => {
				if (active(controller))
					setStatus(
						i18n.t('personalFeatures.checkProgress', { done: values.length, total: tracks.length }),
					)
			})
			if (active(controller)) {
				setEntries(rows)
				setStatus('')
			}
			return rows
		} catch {
			if (active(controller)) Alert.alert(i18n.t('personalFeatures.checkFailed'))
		} finally {
			if (owner.current === controller) owner.current = null
			if (mounted.current) {
				setBusy(false)
				if (controller.signal.aborted) setStatus(i18n.t('personalFeatures.cancelled'))
			}
		}
	}
	const prepare = async (rows = entries) => {
		if (!rows || owner.current) return
		const controller = new AbortController()
		owner.current = controller
		setBusy(true)
		try {
			const result = await prepareTravelMetadata(rows, controller.signal, (done, failed) => {
				if (active(controller))
					setStatus(
						i18n.t('personalFeatures.prepareProgress', { done, total: rows.length, failed }),
					)
			})
			if (active(controller)) {
				const checked = await inspectTravelCollection(
					getListeningCollection(id) ?? [],
					controller.signal,
				)
				if (!active(controller)) return
				setEntries(checked)
				setStatus(i18n.t('personalRefinement.prepared', result))
			}
		} catch (error) {
			if (active(controller))
				Alert.alert(
					i18n.t(
						(error as Error).message === 'WIFI_REQUIRED'
							? 'personalFeatures.wifiRequired'
							: 'personalFeatures.prepareFailed',
					),
				)
		} finally {
			if (owner.current === controller) owner.current = null
			if (mounted.current) {
				setBusy(false)
				if (controller.signal.aborted) setStatus(i18n.t('personalFeatures.cancelled'))
			}
		}
	}
	const missing =
		entries
			?.filter((item) => !item.audio && !item.unknown && item.track.platform !== 'local')
			.map((item) => ({
				...item.track,
				id: item.track.originalId || item.track.id,
				url: 'Unknown',
			})) ?? []
	const collections = [
		{ id: 'favorites', title: i18n.t('appTab.favoritesSongs') },
		...playlists.map((item) => ({ id: item.id, title: item.name })),
		...dynamic.map((item) => ({ id: item.id, title: item.name })),
	]
	inspectAgain.current = inspect
	const relatedKeys = new Set((getListeningCollection(id) ?? []).map(personalTrackKey))
	const relatedTasks = tasks.filter((task) => relatedKeys.has(personalTrackKey(task.track)))
	const taskSignature = JSON.stringify(relatedTasks.map((task) => [task.id, task.status]))
	const hasEntries = entries !== null
	useEffect(() => {
		if (inspectedTasks.current === null) {
			inspectedTasks.current = taskSignature
			return
		}
		if (!hasEntries || busy || previewOpen.current || inspectedTasks.current === taskSignature)
			return
		inspectedTasks.current = taskSignature
		const timer = setTimeout(() => {
			if (!previewOpen.current) void inspectAgain.current()
		}, 400)
		return () => clearTimeout(timer)
	}, [hasEntries, busy, taskSignature])
	const startAll = async () => {
		if (owner.current || previewOpen.current || offline) return
		const rows = await inspect()
		if (!rows || !mounted.current || selection.current !== id) return
		const toDownload = rows
			.filter((entry) => !entry.audio && !entry.unknown && entry.track.platform !== 'local')
			.map((entry) => ({
				...entry.track,
				id: entry.track.originalId || entry.track.id,
				url: 'Unknown',
			}))
		const run = async () => {
			if (!mounted.current || !focused.current || selection.current !== id || owner.current) return
			const controller = new AbortController()
			owner.current = controller
			setBusy(true)
			try {
				const result = await prepareTravelPack(
					() =>
						mounted.current && focused.current && selection.current === id
							? getListeningCollection(id)
							: null,
					new Set(toDownload.map(personalTrackKey)),
					quality,
					controller.signal,
					(done, total, failed) => {
						if (active(controller))
							setStatus(i18n.t('personalFeatures.prepareProgress', { done, total, failed }))
					},
				)
				if (result && active(controller)) {
					setEntries(result.entries)
					setStatus(i18n.t('personalRefinement.prepared', result))
				}
			} catch (error) {
				if (active(controller))
					Alert.alert(
						i18n.t(
							(error as Error).message === 'WIFI_REQUIRED'
								? 'personalFeatures.wifiRequired'
								: (error as Error).message === 'OFFLINE_PLAYBACK'
									? 'personalRefinement.downloadPaused'
									: 'personalFeatures.prepareFailed',
						),
					)
			} finally {
				if (owner.current === controller) {
					owner.current = null
					if (mounted.current) setBusy(false)
				}
			}
		}
		if (toDownload.length) {
			previewOpen.current = true
			await confirmPlaylistDownload(toDownload, quality, run, () => {
				previewOpen.current = false
			})
		} else await run()
	}
	const incomplete =
		entries?.filter((entry) => !entry.audio || !entry.lyric || !entry.artwork) ?? []

	return (
		<ScrollView
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 18, gap: 12 }}
		>
			<Text style={{ color: colors.textMuted }}>{i18n.t('personalRefinement.travelHint')}</Text>
			<Button
				title={i18n.t('personalRefinement.releaseAssets')}
				disabled={busy}
				onPress={() =>
					Alert.alert(
						i18n.t('personalRefinement.releaseAssets'),
						i18n.t('personalRefinement.releaseAssetsHint'),
						[
							{ text: i18n.t('find.cancel'), style: 'cancel' },
							{
								text: i18n.t('common.confirm'),
								onPress: () => {
									try {
										releaseOfflineAssets(getListeningCollection(id) ?? [])
										setStatus(i18n.t('personalRefinement.released'))
									} catch {
										Alert.alert(i18n.t('personalFeatures.prepareFailed'))
									}
								},
							},
						],
					)
				}
			/>
			{offline && (
				<Text style={{ color: colors.primary }}>{i18n.t('personalRefinement.downloadPaused')}</Text>
			)}
			<MenuView
				actions={getDownloadQualityActions()}
				onPressAction={({ nativeEvent: { event } }) => {
					const next = getDownloadQuality(event)
					if (next && !busy) setQuality(next)
				}}
			>
				<Button title={quality.toUpperCase()} disabled={busy} onPress={() => {}} />
			</MenuView>
			<Button
				title={i18n.t('personalRefinement.prepareAll')}
				disabled={busy || !!offline}
				onPress={() =>
					void startAll().catch(() => Alert.alert(i18n.t('personalFeatures.prepareFailed')))
				}
			/>
			{relatedTasks
				.filter((task) =>
					['queued', 'downloading', 'waiting-network', 'paused', 'interrupted'].includes(
						task.status,
					),
				)
				.map((task) => (
					<Text key={task.id} style={{ color: colors.textMuted }}>
						{task.track.title} ·{' '}
						{task.status === 'downloading'
							? i18n.t('cacheCenter.downloading', { progress: Math.round(task.progress * 100) })
							: i18n.t(`cacheCenter.status.${task.status}`)}{' '}
						{Math.round(task.progress * 100)}%
					</Text>
				))}
			<MenuView
				actions={collections.map((item) => ({
					id: item.id,
					title: item.title,
					state: item.id === id ? 'on' : 'off',
				}))}
				onPressAction={({ nativeEvent: { event } }) => {
					if (!busy && collections.some((item) => item.id === event)) setId(event)
				}}
			>
				<Button
					title={
						collections.find((item) => item.id === id)?.title ??
						i18n.t('personalFeatures.collectionGone')
					}
					disabled={busy}
					onPress={() => {}}
				/>
			</MenuView>
			<Button
				title={i18n.t('personalFeatures.check')}
				disabled={busy}
				onPress={() => void inspect()}
			/>
			{busy && <Button title={i18n.t('find.cancel')} onPress={() => owner.current?.abort()} />}
			{!!status && (
				<Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
					{status}
				</Text>
			)}
			{!!incomplete.length && (
				<View style={{ gap: 8 }}>
					<Text style={{ color: colors.text }}>
						{i18n.t('personalRefinement.incomplete', { count: incomplete.length })}
					</Text>
					{incomplete.slice(0, visibleRows).map((entry, index) => {
						const task = relatedTasks.find(
							(item) => personalTrackKey(item.track) === personalTrackKey(entry.track),
						)
						return (
							<Text
								key={`${personalTrackKey(entry.track)}:${index}`}
								style={{ color: colors.textMuted }}
							>
								{entry.track.title} —{' '}
								{[
									!entry.audio &&
										i18n.t(
											entry.unknown
												? 'personalRefinement.audioUnknown'
												: 'personalRefinement.audioMissing',
										),
									!entry.lyric && i18n.t('personalRefinement.lyricMissing'),
									!entry.artwork && i18n.t('personalRefinement.artworkMissing'),
									task?.status === 'failed' && task.error,
								]
									.filter(Boolean)
									.join(' · ')}
							</Text>
						)
					})}
					{incomplete.length > visibleRows && (
						<Button
							title={i18n.t('personalRefinement.more')}
							onPress={() => setVisibleRows((count) => count + 50)}
						/>
					)}
				</View>
			)}
			{entries && (
				<View style={{ gap: 10 }}>
					<Text style={{ color: colors.text, fontSize: 18 }}>
						{i18n.t('personalFeatures.travelSummary', {
							total: entries.length,
							audio: entries.filter((item) => item.audio).length,
							lyric: entries.filter((item) => item.lyric).length,
							artwork: entries.filter((item) => item.artwork).length,
							unknown: entries.filter((item) => item.unknown).length,
						})}
					</Text>
					<Button
						title={i18n.t('personalFeatures.prepareMetadata')}
						disabled={busy || !!offline}
						onPress={() => void prepare()}
					/>
					{!!missing.length && (
						<MenuView
							actions={getDownloadQualityActions()}
							onPressAction={({ nativeEvent: { event } }) => {
								const quality = getDownloadQuality(event)
								if (quality && !busy)
									void confirmPlaylistDownload(missing, quality, async (_tracks, options) => {
										if (!mounted.current || selection.current !== id) return
										const current = getListeningCollection(id)
										if (!current) throw Error()
										const rows = await inspectTravelCollection(
											current,
											new AbortController().signal,
										)
										if (!mounted.current || selection.current !== id) return
										const selected = new Set(
											missing.map((track) => JSON.stringify([track.platform, track.id])),
										)
										const next = (rows ?? [])
											.filter(
												(item) =>
													!item.audio &&
													!item.unknown &&
													selected.has(
														JSON.stringify([
															item.track.platform,
															item.track.originalId || item.track.id,
														]),
													),
											)
											.map((item) => ({
												...item.track,
												id: item.track.originalId || item.track.id,
												url: 'Unknown',
											}))
										await downloadPlaylist(next as IMusic.IMusicItem[], {
											...options,
											wifiOnly: true,
										})
										setEntries(null)
										setStatus(i18n.t('personalFeatures.audioQueued'))
									})
							}}
						>
							<Button
								title={i18n.t('personalFeatures.fillAudio', { count: missing.length })}
								disabled={busy}
								onPress={() => {}}
							/>
						</MenuView>
					)}
				</View>
			)}
			<Button
				title={i18n.t('settings.items.manageCache')}
				onPress={() => router.push('/(modals)/cacheManager')}
			/>
		</ScrollView>
	)
}
