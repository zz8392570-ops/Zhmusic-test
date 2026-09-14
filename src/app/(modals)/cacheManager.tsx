import { ThemeColors } from '@/constants/tokens'
import myTrackPlayer, {
	cacheDownloadTasksStore,
	cacheRevisionStore,
	importedLocalMusicStore,
} from '@/helpers/trackPlayerIndex'
import { getCacheSize } from '@/player/CacheManager'
import type { CacheDownloadTask } from '@/player/PlayerStore'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { Image } from 'expo-image'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

const taskStatusText = (task: CacheDownloadTask) => {
	if (task.status === 'downloading') {
		return i18n.t('cacheCenter.downloading', { progress: Math.round(task.progress * 100) })
	}
	return i18n.t(`cacheCenter.status.${task.status}`)
}

const CacheManagerScreen = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const tasks = cacheDownloadTasksStore.useValue() || []
	const importedTracksValue = importedLocalMusicStore.useValue()
	const importedTracks = useMemo(() => importedTracksValue || [], [importedTracksValue])
	const revision = cacheRevisionStore.useValue()
	const [cacheSize, setCacheSize] = useState(0)
	const cachedTracks = useMemo(
		() => importedTracks.filter((track) => String(track.url || '').includes('/musicCache/')),
		[importedTracks],
	)

	const refreshSize = useCallback(() => {
		void getCacheSize()
			.then(setCacheSize)
			.catch(() => setCacheSize(0))
	}, [])

	useEffect(refreshSize, [refreshSize, revision, cachedTracks.length])

	const retryTask = (task: CacheDownloadTask) => {
		void myTrackPlayer.cacheAndImportMusic(task.track, { quality: task.quality })
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
						await myTrackPlayer.deleteImportedLocalMusic(track.id)
						refreshSize()
					},
				},
			],
		)
	}

	return (
		<ScrollView style={styles.container} contentContainerStyle={styles.content}>
			<View style={styles.summary}>
				<Text style={styles.summaryValue}>{formatBytes(cacheSize)}</Text>
				<Text style={styles.summaryLabel}>
					{i18n.t('cacheCenter.summary', { count: cachedTracks.length })}
				</Text>
			</View>

			{tasks.length ? (
				<View style={styles.section}>
					<Text style={styles.sectionTitle}>{i18n.t('cacheCenter.tasks')}</Text>
					{tasks.map((task) => (
						<View key={task.id} style={styles.taskRow}>
							<View style={styles.rowText}>
								<Text style={styles.title} numberOfLines={1}>
									{task.track.title}
								</Text>
								<Text style={styles.meta}>
									{task.quality.toUpperCase()} · {taskStatusText(task)}
								</Text>
								{task.status === 'downloading' ? (
									<View style={styles.progressTrack}>
										<View
											style={[
												styles.progressFill,
												{ width: `${Math.max(2, task.progress * 100)}%` },
											]}
										/>
									</View>
								) : null}
							</View>
							{task.status === 'downloading' ? (
								<Pressable
									accessibilityRole="button"
									onPress={() => void myTrackPlayer.cancelCacheDownload(task.id)}
									style={styles.action}
								>
									<Text style={styles.actionText}>{i18n.t('cacheCenter.cancel')}</Text>
								</Pressable>
							) : task.status === 'failed' || task.status === 'cancelled' ? (
								<Pressable
									accessibilityRole="button"
									onPress={() => retryTask(task)}
									style={styles.action}
								>
									<Text style={styles.actionText}>{i18n.t('cacheCenter.retry')}</Text>
								</Pressable>
							) : null}
						</View>
					))}
				</View>
			) : null}

			<View style={styles.section}>
				<Text style={styles.sectionTitle}>{i18n.t('cacheCenter.cachedSongs')}</Text>
				{cachedTracks.length ? (
					cachedTracks.map((track) => (
						<View key={`${track.platform}:${track.id}:${track.url}`} style={styles.trackRow}>
							<Image source={track.artwork} style={styles.artwork} contentFit="cover" />
							<View style={styles.rowText}>
								<Text style={styles.title} numberOfLines={1}>
									{track.title}
								</Text>
								<Text style={styles.meta} numberOfLines={1}>
									{track.artist} ·{' '}
									{(track.cachedQuality || track.format || 'unknown').toUpperCase()}
								</Text>
							</View>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={i18n.t('cacheCenter.deleteTitle')}
								onPress={() => deleteTrack(track)}
								style={styles.action}
							>
								<Text style={styles.deleteText}>{i18n.t('localMusic.delete')}</Text>
							</Pressable>
						</View>
					))
				) : (
					<Text style={styles.empty}>{i18n.t('cacheCenter.empty')}</Text>
				)}
			</View>
		</ScrollView>
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
