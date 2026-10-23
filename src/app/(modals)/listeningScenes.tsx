import { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native'
import { MenuView } from '@/components/ActionMenu'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import PersistStatus from '@/store/PersistStatus'
import { getListeningScenes, startListeningScene } from '@/helpers/listeningSceneActions'
import { isValidScenes, type ListeningScene } from '@/helpers/personalFeatures'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { showToast } from '@/utils/utils'
export default function ListeningScenesScreen() {
	const colors = useThemeColors(),
		stored = PersistStatus.useValue('music.listeningScenes'),
		playlists = PersistStatus.useValue('music.playLists', []) ?? []
	const scenes = stored ?? getListeningScenes()
	const [draft, setDraft] = useState<ListeningScene | null>(null),
		[busy, setBusy] = useState(false)
	const owner = useRef<AbortController | null>(null),
		mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			owner.current?.abort()
		}
	}, [])
	const collections = [
		{ id: 'favorites', title: i18n.t('appTab.favoritesSongs') },
		...playlists.map((item) => ({ id: item.id, title: item.name })),
	]
	const save = () => {
		if (!draft) return
		const scene = { ...draft, name: draft.name.trim() }
		const latest = getListeningScenes()
		const next = latest.some((item) => item.id === scene.id)
			? latest.map((item) => (item.id === scene.id ? scene : item))
			: [...latest, scene]
		try {
			if (!isValidScenes(next)) throw Error()
			PersistStatus.set('music.listeningScenes', next)
			setDraft(null)
			showToast(i18n.t('personalFeatures.saved'), '', 'success')
		} catch {
			Alert.alert(i18n.t('personalFeatures.saveFailed'))
		}
	}
	const run = async (scene: ListeningScene) => {
		if (owner.current) return
		const controller = new AbortController()
		owner.current = controller
		setBusy(true)
		try {
			if ((await startListeningScene(scene, controller.signal)) && mounted.current)
				showToast(i18n.t('personalFeatures.sceneStarted'), scene.name, 'success')
		} catch (error) {
			if (mounted.current && !controller.signal.aborted)
				Alert.alert(i18n.t('personalFeatures.sceneFailed'), (error as Error).message)
		} finally {
			if (owner.current === controller) owner.current = null
			if (mounted.current) setBusy(false)
		}
	}
	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 18, gap: 10 }}
		>
			<Text style={{ color: colors.textMuted }}>{i18n.t('personalFeatures.sceneHint')}</Text>
			{busy && (
				<Button
					title={i18n.t('find.cancel')}
					onPress={() => {
						owner.current?.abort()
					}}
				/>
			)}
			{draft ? (
				<View style={{ gap: 10 }}>
					<TextInput
						accessibilityLabel={i18n.t('personalFeatures.name')}
						value={draft.name}
						maxLength={40}
						onChangeText={(name) => setDraft({ ...draft, name })}
						style={{
							color: colors.text,
							backgroundColor: colors.surfaceMuted,
							padding: 14,
							borderRadius: 12,
						}}
					/>
					<MenuView
						actions={collections.map((item) => ({
							id: item.id,
							title: item.title,
							state: item.id === draft.collectionId ? 'on' : 'off',
						}))}
						onPressAction={({ nativeEvent: { event } }) => {
							if (collections.some((item) => item.id === event))
								setDraft({ ...draft, collectionId: event })
						}}
					>
						<Button
							title={
								collections.find((item) => item.id === draft.collectionId)?.title ??
								i18n.t('personalFeatures.collectionGone')
							}
							onPress={() => {}}
						/>
					</MenuView>
					{[
						['shuffle', 'personalFeatures.shuffle'],
						['offlineOnly', 'personalFeatures.offlineOnly'],
					].map(([key, label]) => (
						<View
							key={key}
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								justifyContent: 'space-between',
							}}
						>
							<Text style={{ color: colors.text }}>{i18n.t(label)}</Text>
							<Switch
								accessibilityLabel={i18n.t(label)}
								value={draft[key] as boolean}
								onValueChange={(value) => setDraft({ ...draft, [key]: value })}
							/>
						</View>
					))}
					<MenuView
						actions={[0, 15, 30, 45, 60, 90, 120, 180].map((minutes) => ({
							id: String(minutes),
							title: minutes
								? i18n.t('personalFeatures.minutes', { count: minutes })
								: i18n.t('personalFeatures.noTimer'),
							state: draft.sleepMinutes === minutes ? 'on' : 'off',
						}))}
						onPressAction={({ nativeEvent: { event } }) => {
							const minutes = Number(event)
							if ([0, 15, 30, 45, 60, 90, 120, 180].includes(minutes))
								setDraft({ ...draft, sleepMinutes: minutes })
						}}
					>
						<Button
							title={
								draft.sleepMinutes
									? i18n.t('personalFeatures.minutes', { count: draft.sleepMinutes })
									: i18n.t('personalFeatures.noTimer')
							}
							onPress={() => {}}
						/>
					</MenuView>
					<Button title={i18n.t('personalFeatures.save')} onPress={save} />
					<Button title={i18n.t('find.cancel')} onPress={() => setDraft(null)} />
				</View>
			) : (
				<>
					{scenes.map((scene) => (
						<View
							key={scene.id}
							style={{ padding: 14, backgroundColor: colors.surfaceElevated, borderRadius: 14 }}
						>
							<Text style={{ color: colors.text, fontSize: 20, fontWeight: '600' }}>
								{scene.name}
							</Text>
							<Text style={{ color: colors.textMuted, marginVertical: 8 }}>
								{collections.find((item) => item.id === scene.collectionId)?.title ??
									i18n.t('personalFeatures.collectionGone')}{' '}
								· {i18n.t(scene.shuffle ? 'personalFeatures.shuffle' : 'personalFeatures.inOrder')}
								{scene.offlineOnly ? ` · ${i18n.t('personalFeatures.offlineOnly')}` : ''}
								{scene.sleepMinutes ? ` · ${scene.sleepMinutes} min` : ''}
							</Text>
							<Button
								title={i18n.t('personalFeatures.start')}
								disabled={busy}
								onPress={() => void run(scene)}
							/>
							<Button
								title={i18n.t('personalFeatures.edit')}
								disabled={busy}
								onPress={() => setDraft({ ...scene })}
							/>
							<Button
								title={i18n.t('common.delete')}
								danger
								disabled={busy}
								onPress={() =>
									Alert.alert(i18n.t('personalFeatures.deleteScene'), scene.name, [
										{ text: i18n.t('find.cancel'), style: 'cancel' },
										{
											text: i18n.t('common.confirm'),
											style: 'destructive',
											onPress: () => {
												try {
													PersistStatus.set(
														'music.listeningScenes',
														(
															PersistStatus.get('music.listeningScenes') ?? getListeningScenes()
														).filter((item) => item.id !== scene.id),
													)
												} catch {
													Alert.alert(i18n.t('personalFeatures.saveFailed'))
												}
											},
										},
									])
								}
							/>
						</View>
					))}
					<Button
						title={i18n.t('personalFeatures.addScene')}
						disabled={busy || scenes.length >= 20}
						onPress={() =>
							setDraft({
								id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
								name: i18n.t('personalFeatures.newScene'),
								collectionId: 'favorites',
								shuffle: false,
								offlineOnly: false,
								sleepMinutes: 0,
							})
						}
					/>
				</>
			)}
		</ScrollView>
	)
}
