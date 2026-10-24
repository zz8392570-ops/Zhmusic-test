import { useCallback, useRef, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import PersistStatus from '@/store/PersistStatus'
import { getListeningScenes, startListeningScene } from '@/helpers/listeningSceneActions'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useTimingClose, setTimingClose } from '@/utils/timingClose'
import { LibraryToolButton as Button } from './LibraryToolButton'
import i18n from '@/utils/i18n'

export default function SceneShortcuts() {
	const colors = useThemeColors()
	const stored = PersistStatus.useValue('music.listeningScenes')
	const dynamic = PersistStatus.useValue('music.tagCollections', []) ?? []
	const offline = PersistStatus.useValue('music.offlinePlayback', false)
	const scenes = (stored ?? getListeningScenes()).filter((scene) => scene.pinned)
	const remaining = useTimingClose()
	const owner = useRef<AbortController | null>(null)
	const [busy, setBusy] = useState(false)
	useFocusEffect(
		useCallback(() => {
			setBusy(false)
			return () => {
				owner.current?.abort()
				owner.current = null
			}
		}, []),
	)
	return (
		<View style={{ gap: 8, marginVertical: 12 }}>
			{offline && (
				<Text style={{ color: colors.primary }}>
					{i18n.t('personalRefinement.offlinePlayback')}
				</Text>
			)}
			{scenes.map((scene) => (
				<Button
					key={scene.id}
					disabled={busy}
					title={`▶ ${scene.name}`}
					onPress={() => {
						if (owner.current) return
						const controller = new AbortController()
						owner.current = controller
						setBusy(true)
						void startListeningScene(scene, controller.signal)
							.catch((error) => {
								if (!controller.signal.aborted)
									Alert.alert(i18n.t('personalFeatures.sceneFailed'), error.message)
							})
							.finally(() => {
								if (owner.current === controller) {
									owner.current = null
									setBusy(false)
								}
							})
					}}
				/>
			))}
			{busy && (
				<Button
					title={i18n.t('find.cancel')}
					onPress={() => {
						owner.current?.abort()
					}}
				/>
			)}
			{!!remaining && (
				<Button
					title={i18n.t('personalRefinement.timerRemaining', { count: Math.ceil(remaining / 60) })}
					onPress={() => {
						setTimingClose(null)
					}}
				/>
			)}
			{dynamic.map((item) => (
				<Button
					key={item.id}
					title={`${i18n.t('personalRefinement.dynamicPlaylist')} · ${item.name}`}
					onPress={() =>
						router.push({ pathname: '/(modals)/songTags', params: { collection: item.id } } as any)
					}
				/>
			))}
		</View>
	)
}
