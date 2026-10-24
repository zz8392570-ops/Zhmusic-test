import { clearOfflineAssets, getOfflineAssetUsage } from '@/helpers/offlineAssets'
import OfflineAvailabilityLabel from '@/components/OfflineAvailabilityLabel'
import { ThemeColors } from '@/constants/tokens'
import myTrackPlayer, {
	cacheDownloadTasksStore,
	cacheRevisionStore,
	importedLocalMusicStore,
} from '@/helpers/trackPlayerIndex'
import { getCacheUsage } from '@/player/CacheManager'
import type { CacheDownloadTask } from '@/player/PlayerStore'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import PersistStatus from '@/store/PersistStatus'
import { MenuView } from '@/components/ActionMenu'
import { FlashList } from '@shopify/flash-list'
import { Image } from 'expo-image'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, Switch, View } from 'react-native'

const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
	return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

const CACHE_LIMIT_OPTIONS_MB = [256, 512, 1024, 2048, 4096, 8192]
const formatCacheLimit = (limitMB: number) =>
	limitMB >= 1024 ? `${limitMB / 1024} GB` : `${limitMB} MB`

const taskStatusText = (task: CacheDownloadTask) => {
	if (task.status === 'downloading') {
		return i18n.t('cacheCenter.downloading', { progress: Math.round(task.progress * 100) })
	}
	return i18n.t(`cacheCenter.status.${task.status}`)
}

const CacheManagerScreen = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const tasksValue = cacheDownloadTasksStore.useValue()
	const tasks = useMemo(() => tasksValue ?? [], [tasksValue])
	const importedTracksValue = importedLocalMusicStore.useValue()
	const importedTracks = useMemo(() => importedTracksValue || [], [importedTracksValue])
	const revision = cacheRevisionStore.useValue()
	const [cacheUsage, setCacheUsage] = useState({ automatic: 0, saved: 0, total: 0 })
	const [assetUsage, setAssetUsage] = useState({ lyric: 0, artwork: 0, protected: 0, total: 0 })
	const [assetBusy, setAssetBusy] = useState(false)
	const [usageFailed, setUsageFailed] = useState(false)
	const wifiOnly = PersistStatus.useValue('music.downloadWifiOnly', false) ?? false
	const allowDuplicates = PersistStatus.useValue('music.allowDuplicateDownloads', false) ?? false
	const cacheLimitMB = PersistStatus.useValue('music.cacheLimitMB', 1024) ?? 1024
	const cachedTracks = useMemo(
		() => importedTracks.filter((track) => String(track.url || '').includes('/musicCache/')),
		[importedTracks],
	)

	const [sizeRefresh, setSizeRefresh] = useState(0)
	const refreshSize = useCallback(() => setSizeRefresh((value) => value + 1), [])
	useEffect(() => {
		let active = true
		void Promise.all([getCacheUsage(), getOfflineAssetUsage()])
			.then(([usage, assets]) => {
				if (active) {
					setCacheUsage(usage)
					setAssetUsage(assets)
					setUsageFailed(false)
				}
			})
			.catch(() => {
				if (active) setUsageFailed(true)
			})
		return () => {
			active = false
		}
	}, [revision, cachedTracks.length, sizeRefresh])

	const retryTask = (task: CacheDownloadTask) => {
		void myTrackPlayer.cacheAndImportMusic(task.track, {
			quality: task.quality,
			kind: task.kind,
			strictQuality: task.strictQuality,
		})
	}

	const deleteTrack = (track: IMusic.IMusicItem) => {
		Alert.alert(
			i18n.t('cacheCenter.deleteTitle'),
			i18n.t('cacheCenter.deleteMessage', { name: track.title }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('localMusic.delete'),
					style: 'destructive',
					onPress: async () => {
						try {
							await myTrackPlayer.deleteImportedLocalMusic(track)
							if (
								(importedLocalMusicStore.getValue() as IMusic.IMusicItem[] | null)?.some(
									(item) => item.url === track.url,
								)
							)
								throw new Error('Delete failed')
							refreshSize()
						} catch {
							Alert.alert(i18n.t('cacheCenter.deleteFailed', { count: 1 }))
						}
					},
				},
			],
		)
	}

	const [filter, setFilter] = useState<'all' | 'automatic' | 'saved'>('all')
	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [selecting, setSelecting] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const filteredTracks = useMemo(
		() =>
			cachedTracks.filter(
				(track) =>
					(filter === 'all' || (track.cacheKind ?? 'saved') === filter) &&
					`${track.title} ${track.artist}`
						.toLocaleLowerCase()
						.includes(query.trim().toLocaleLowerCase()),
			),
		[cachedTracks, filter, query],
	)
	type Row =
		| { type: 'task'; task: CacheDownloadTask }
		| { type: 'track'; track: IMusic.IMusicItem }
		| { type: 'heading'; title: string }
	const rows = useMemo<Row[]>(
		() => [
			...(tasks.length
				? [
						{ type: 'heading' as const, title: i18n.t('cacheCenter.tasks') },
						...tasks.map((task) => ({ type: 'task' as const, task })),
					]
				: []),
			{ type: 'heading', title: i18n.t('cacheCenter.cachedSongs') },
			...filteredTracks.map((track) => ({ type: 'track' as const, track })),
		],
		[tasks, filteredTracks],
	)
	const toggleSelection = (url: string) =>
		setSelected((previous) => {
			const next = new Set(previous)
			if (next.has(url)) next.delete(url)
			else next.add(url)
			return next
		})
	const deleteSelected = () => {
		const tracks = cachedTracks.filter((track) => selected.has(String(track.url)))
		if (!tracks.length || deleting) return
		Alert.alert(
			i18n.t('cacheCenter.deleteTitle'),
			i18n.t('cacheCenter.deleteSelectedConfirm', { count: tracks.length }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('localMusic.delete'),
					style: 'destructive',
					onPress: () => {
						setDeleting(true)
						void (async () => {
							let failures = 0
							for (const track of tracks) {
								try {
									await myTrackPlayer.deleteImportedLocalMusic(track)
									if (
										(importedLocalMusicStore.getValue() as IMusic.IMusicItem[] | null)?.some(
											(item) => item.url === track.url,
										)
									)
										throw new Error('Delete failed')
								} catch {
									failures++
								}
							}
							setSelected(
								new Set(
									tracks
										.filter((track) =>
											(importedLocalMusicStore.getValue() as IMusic.IMusicItem[] | null)?.some(
												(item) => item.url === track.url,
											),
										)
										.map((track) => String(track.url)),
								),
							)
							setDeleting(false)
							refreshSize()
							if (failures) Alert.alert(i18n.t('cacheCenter.deleteFailed', { count: failures }))
						})()
					},
				},
			],
		)
	}

	const renderTask = (task: CacheDownloadTask) => (
		<View key={task.id} style={styles.taskRow}>
			<View style={styles.rowText}>
				<Text style={styles.title} numberOfLines={1}>
					{task.track.title}
				</Text>
				<Text style={styles.meta}>
					{task.quality.toUpperCase()} · {taskStatusText(task)}
				</Text>
				{task.status === 'downloading' && task.bytesWritten !== undefined ? (
					<Text style={styles.meta}>
						{formatBytes(task.bytesWritten)} /{' '}
						{task.contentLength
							? formatBytes(task.contentLength)
							: i18n.t('cacheCenter.unknownSize')}
						{task.bytesPerSecond ? ` · ${formatBytes(task.bytesPerSecond)}/s` : ''}
						{task.remainingSeconds
							? ` · ${i18n.t('cacheCenter.remaining', { seconds: Math.ceil(task.remainingSeconds) })}`
							: ''}
					</Text>
				) : null}
				{task.error ? (
					<Text style={styles.meta} numberOfLines={2}>
						{task.error}
					</Text>
				) : null}
				{task.status === 'downloading' ? (
					<View style={styles.progressTrack}>
						<View
							style={[styles.progressFill, { width: `${Math.max(2, task.progress * 100)}%` }]}
						/>
					</View>
				) : null}
			</View>
			{['waiting-network', 'downloading', 'queued'].includes(task.status) ? (
				<Pressable
					style={styles.action}
					onPress={() => void myTrackPlayer.pauseCacheDownload(task.id)}
				>
					<Text style={styles.actionText}>{i18n.t('cacheCenter.pause')}</Text>
				</Pressable>
			) : ['paused', 'interrupted'].includes(task.status) ? (
				<Pressable style={styles.action} onPress={() => myTrackPlayer.resumeCacheDownload(task.id)}>
					<Text style={styles.actionText}>{i18n.t('cacheCenter.resume')}</Text>
				</Pressable>
			) : null}
			{['waiting-network', 'downloading', 'queued', 'paused', 'interrupted'].includes(
				task.status,
			) ? (
				<Pressable
					accessibilityRole="button"
					onPress={() => void myTrackPlayer.cancelCacheDownload(task.id)}
					style={styles.action}
				>
					<Text style={styles.actionText}>{i18n.t('cacheCenter.cancel')}</Text>
				</Pressable>
			) : ['failed', 'cancelled', 'interrupted'].includes(task.status) ? (
				<Pressable accessibilityRole="button" onPress={() => retryTask(task)} style={styles.action}>
					<Text style={styles.actionText}>{i18n.t('cacheCenter.retry')}</Text>
				</Pressable>
			) : null}
		</View>
	)
	const renderTrack = (track: IMusic.IMusicItem) => (
		<View key={`${track.platform}:${track.id}:${track.url}`} style={styles.trackRow}>
			{selecting ? (
				<Pressable
					disabled={deleting}
					accessibilityRole="checkbox"
					accessibilityState={{ checked: selected.has(String(track.url)) }}
					accessibilityLabel={track.title}
					onPress={() => toggleSelection(String(track.url))}
					style={styles.action}
				>
					<Text style={styles.actionText}>{selected.has(String(track.url)) ? '☑' : '☐'}</Text>
				</Pressable>
			) : null}
			<Image source={track.artwork} style={styles.artwork} contentFit="cover" />
			<View style={styles.rowText}>
				<Text style={styles.title} numberOfLines={1}>
					{track.title}
				</Text>
				<Text style={styles.meta} numberOfLines={1}>
					{track.artist} · {(track.cachedQuality || track.format || 'unknown').toUpperCase()} ·{' '}
					{i18n.t(track.cacheKind === 'automatic' ? 'cacheCenter.automatic' : 'cacheCenter.saved')}
				</Text>
				<OfflineAvailabilityLabel track={track} />
			</View>
			{track.cacheKind === 'automatic' ? (
				<Pressable
					accessibilityRole="button"
					onPress={() => void myTrackPlayer.cacheAndImportMusic(track, { kind: 'saved' })}
					style={styles.action}
				>
					<Text style={styles.actionText}>{i18n.t('cacheCenter.keepOffline')}</Text>
				</Pressable>
			) : null}
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={i18n.t('cacheCenter.deleteTitle')}
				disabled={deleting}
				onPress={() => deleteTrack(track)}
				style={styles.action}
			>
				<Text style={styles.deleteText}>{i18n.t('localMusic.delete')}</Text>
			</Pressable>
		</View>
	)
	return (
		<FlashList<Row>
			style={styles.container}
			contentContainerStyle={styles.content}
			data={rows}
			extraData={{ selected, selecting, deleting }}
			keyExtractor={(row) =>
				row.type === 'task'
					? `task:${row.task.id}`
					: row.type === 'track'
						? `track:${row.track.url}`
						: `heading:${row.title}`
			}
			getItemType={(row) => row.type}
			renderItem={({ item }) =>
				item.type === 'task' ? (
					renderTask(item.task)
				) : item.type === 'track' ? (
					renderTrack(item.track)
				) : (
					<Text style={styles.sectionTitle}>{item.title}</Text>
				)
			}
			ListHeaderComponent={
				<View>
					<View style={styles.summary}>
						<Text style={styles.summaryValue}>
							{usageFailed
								? i18n.t('personalRefinement.usageFailed')
								: formatBytes(cacheUsage.total + assetUsage.total)}
						</Text>
						<Text style={styles.summaryLabel}>
							{i18n.t('cacheCenter.automatic')} {formatBytes(cacheUsage.automatic)} ·{' '}
							{i18n.t('cacheCenter.saved')} {formatBytes(cacheUsage.saved)}
						</Text>
						<Text style={styles.summaryLabel}>
							{i18n.t('cacheCenter.summary', { count: cachedTracks.length })}
						</Text>
						<Text style={styles.summaryLabel}>{i18n.t('offline.retentionHint')}</Text>
						<Text style={styles.summaryLabel}>
							{i18n.t('personalRefinement.assetUsage', {
								lyric: formatBytes(assetUsage.lyric),
								artwork: formatBytes(assetUsage.artwork),
								retained: formatBytes(assetUsage.protected),
							})}
						</Text>
						<Pressable
							accessibilityRole="button"
							disabled={assetBusy}
							style={styles.action}
							onPress={() =>
								Alert.alert(
									i18n.t('personalRefinement.clearAssets'),
									i18n.t('personalRefinement.clearAssetsHint'),
									[
										{ text: i18n.t('find.cancel'), style: 'cancel' },
										{
											text: i18n.t('personalRefinement.clearAssets'),
											onPress: async () => {
												setAssetBusy(true)
												try {
													await clearOfflineAssets()
													refreshSize()
												} catch {
													Alert.alert(i18n.t('settings.actions.cache.error'))
												} finally {
													setAssetBusy(false)
												}
											},
										},
									],
								)
							}
						>
							<Text style={styles.actionText}>{i18n.t('personalRefinement.clearAssets')}</Text>
						</Pressable>
					</View>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
							paddingVertical: 16,
							gap: 12,
						}}
					>
						<Text style={[styles.title, { flex: 1 }]}>{i18n.t('cacheCenter.wifiOnly')}</Text>
						<Switch
							accessibilityLabel={i18n.t('cacheCenter.wifiOnly')}
							value={wifiOnly}
							onValueChange={(value) => {
								try {
									PersistStatus.set('music.downloadWifiOnly', value)
								} catch {
									Alert.alert(i18n.t('settings.actions.cache.error'))
								}
							}}
						/>
					</View>
					<View
						style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
					>
						<View style={{ flex: 1 }}>
							<Text style={styles.title}>{i18n.t('downloadDedup.allow')}</Text>
							<Text style={styles.summaryLabel}>{i18n.t('downloadDedup.description')}</Text>
						</View>
						<Switch
							accessibilityLabel={i18n.t('downloadDedup.allow')}
							value={allowDuplicates}
							onValueChange={(value) => {
								try {
									PersistStatus.set('music.allowDuplicateDownloads', value)
								} catch {
									Alert.alert(i18n.t('common.error'))
								}
							}}
						/>
					</View>
					<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
						{tasks.some((task) =>
							['queued', 'downloading', 'waiting-network'].includes(task.status),
						) ? (
							<Pressable
								style={styles.action}
								accessibilityRole="button"
								onPress={() =>
									void myTrackPlayer
										.pauseAllCacheDownloads()
										.catch(() => Alert.alert(i18n.t('settings.actions.cache.error')))
								}
							>
								<Text style={styles.actionText}>{i18n.t('cacheCenter.pauseAll')}</Text>
							</Pressable>
						) : null}
						{tasks.some((task) => task.status === 'failed') ? (
							<Pressable
								style={styles.action}
								accessibilityRole="button"
								onPress={() =>
									void myTrackPlayer
										.retryFailedCacheDownloads()
										.catch(() => Alert.alert(i18n.t('settings.actions.cache.error')))
								}
							>
								<Text style={styles.actionText}>{i18n.t('cacheCenter.retryFailed')}</Text>
							</Pressable>
						) : null}
					</View>
					<View style={styles.section}>
						<MenuView
							actions={CACHE_LIMIT_OPTIONS_MB.map((limit) => ({
								id: String(limit),
								title: formatCacheLimit(limit),
								state: limit === cacheLimitMB ? 'on' : 'off',
							}))}
							onPressAction={({ nativeEvent: { event } }) =>
								void myTrackPlayer
									.setCacheLimitMB(Number(event))
									.catch(() => Alert.alert(i18n.t('settings.actions.cache.error')))
							}
						>
							<Pressable
								accessibilityRole="button"
								style={styles.trackRow}
								accessibilityLabel={i18n.t('cacheCenter.limit')}
							>
								<Text style={[styles.title, { flex: 1 }]}>{i18n.t('cacheCenter.limit')}</Text>
								<Text style={styles.meta}>{formatCacheLimit(cacheLimitMB)} ›</Text>
							</Pressable>
						</MenuView>
						<Text style={[styles.meta, { paddingBottom: 14 }]}>
							{i18n.t('cacheCenter.retentionHint')}
						</Text>
					</View>

					<Text style={[styles.meta, { marginTop: 12 }]}>{i18n.t('cacheCenter.resumeHint')}</Text>
					<View style={{ gap: 10, marginTop: 16 }}>
						<TextInput
							value={query}
							onChangeText={setQuery}
							placeholder={i18n.t('cacheCenter.search')}
							placeholderTextColor={colors.textMuted}
							style={[
								styles.title,
								{ backgroundColor: colors.surfaceElevated, borderRadius: 10, padding: 12 },
							]}
						/>
						<View style={{ flexDirection: 'row', gap: 16 }}>
							{(['all', 'automatic', 'saved'] as const).map((value) => (
								<Pressable
									key={value}
									style={styles.action}
									onPress={() => setFilter(value)}
									accessibilityRole="button"
									accessibilityState={{ selected: value === filter }}
								>
									<Text style={value === filter ? styles.actionText : styles.meta}>
										{i18n.t(`cacheCenter.${value}`)}
									</Text>
								</Pressable>
							))}
							<Pressable
								disabled={deleting}
								style={styles.action}
								onPress={() => {
									setSelecting(!selecting)
									setSelected(new Set())
								}}
							>
								<Text style={styles.actionText}>
									{i18n.t(selecting ? 'find.cancel' : 'cacheCenter.select')}
								</Text>
							</Pressable>
						</View>
						{selecting ? (
							<View style={{ flexDirection: 'row', gap: 16 }}>
								<Pressable
									disabled={deleting}
									style={styles.action}
									onPress={() =>
										setSelected(new Set(filteredTracks.map((track) => String(track.url))))
									}
								>
									<Text style={styles.actionText}>{i18n.t('cacheCenter.selectAll')}</Text>
								</Pressable>
								<Pressable
									disabled={deleting || !selected.size}
									style={styles.action}
									onPress={deleteSelected}
								>
									<Text style={styles.deleteText}>
										{i18n.t('cacheCenter.deleteSelected', { count: selected.size })}
									</Text>
								</Pressable>
							</View>
						) : null}
						{tasks.some((task) => ['paused', 'interrupted'].includes(task.status)) ? (
							<Pressable style={styles.action} onPress={myTrackPlayer.resumeCacheDownloads}>
								<Text style={styles.actionText}>{i18n.t('cacheCenter.resumeAll')}</Text>
							</Pressable>
						) : null}
					</View>
				</View>
			}
			ListFooterComponent={
				!filteredTracks.length ? (
					<Text style={styles.empty}>{i18n.t('cacheCenter.empty')}</Text>
				) : null
			}
		/>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: { flex: 1, backgroundColor: colors.background },
		content: { padding: 16, paddingBottom: 48 },
		summary: {
			alignItems: 'center',
			backgroundColor: colors.surfaceElevated,
			borderRadius: 18,
			padding: 24,
		},
		summaryValue: { color: colors.text, fontSize: 34, fontWeight: '700' },
		summaryLabel: { color: colors.textMuted, fontSize: 14, marginTop: 6 },
		section: {
			backgroundColor: colors.surfaceElevated,
			borderRadius: 16,
			marginTop: 18,
			overflow: 'hidden',
			paddingHorizontal: 14,
		},
		sectionTitle: {
			color: colors.text,
			fontSize: 17,
			fontWeight: '700',
			paddingBottom: 10,
			paddingTop: 16,
		},
		taskRow: {
			alignItems: 'center',
			borderTopColor: colors.separator,
			borderTopWidth: StyleSheet.hairlineWidth,
			flexDirection: 'row',
			minHeight: 68,
			paddingVertical: 10,
		},
		trackRow: {
			alignItems: 'center',
			borderTopColor: colors.separator,
			borderTopWidth: StyleSheet.hairlineWidth,
			flexDirection: 'row',
			minHeight: 68,
			paddingVertical: 8,
		},
		artwork: {
			backgroundColor: colors.artworkPlaceholder,
			borderRadius: 6,
			height: 46,
			marginRight: 11,
			width: 46,
		},
		rowText: { flex: 1, marginRight: 10 },
		title: { color: colors.text, fontSize: 15, fontWeight: '600' },
		meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
		progressTrack: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 2,
			height: 4,
			marginTop: 8,
			overflow: 'hidden',
		},
		progressFill: { backgroundColor: colors.primary, borderRadius: 2, height: 4 },
		action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
		actionText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
		deleteText: { color: colors.error, fontSize: 14, fontWeight: '600' },
		empty: {
			color: colors.textMuted,
			fontSize: 14,
			paddingBottom: 22,
			paddingTop: 8,
			textAlign: 'center',
		},
	})

export default CacheManagerScreen
