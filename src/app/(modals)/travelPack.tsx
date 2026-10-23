import { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
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
		owner = useRef<AbortController | null>(null),
		mounted = useRef(true),
		selection = useRef(id)
	selection.current = id
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
	}, [id])
	const active = (controller: AbortController) =>
		mounted.current && !controller.signal.aborted && selection.current === id
	const inspect = async () => {
		if (owner.current) return
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
	const prepare = async () => {
		if (!entries || owner.current) return
		const controller = new AbortController()
		owner.current = controller
		setBusy(true)
		try {
			const result = await prepareTravelMetadata(entries, controller.signal, (done, failed) => {
				if (active(controller))
					setStatus(
						i18n.t('personalFeatures.prepareProgress', { done, total: entries.length, failed }),
					)
			})
			if (active(controller)) {
				setEntries(null)
				setStatus(i18n.t('personalFeatures.prepareDone', result))
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
	]
	return (
		<ScrollView
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 18, gap: 12 }}
		>
			<Text style={{ color: colors.textMuted }}>{i18n.t('personalFeatures.travelHint')}</Text>
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
						disabled={busy}
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
