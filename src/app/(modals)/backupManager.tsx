import {
	createMusicBackup,
	parseMusicBackup,
	restoreMusicBackup,
	MAX_BACKUP_BYTES,
	MusicBackup,
} from '@/helpers/musicBackup'
import myTrackPlayer, { playListsStore, recentlyPlayedStore } from '@/helpers/trackPlayerIndex'
import { useThemeColors, useThemeMode } from '@/hooks/useAppTheme'
import { useLibraryStore } from '@/store/library'
import { songsNumsToLoadStore } from '@/player/PlayerStore'
import i18n, { changeLanguage } from '@/utils/i18n'
import { shareLocalFiles } from '../../../modules/cymusic-native/sharing'
import Constants from 'expo-constants'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native'

export default function BackupManagerScreen() {
	const colors = useThemeColors()
	const { setThemeMode } = useThemeMode()
	const [backup, setBackup] = useState<MusicBackup | null>(null)
	const [busy, setBusy] = useState(false)
	const [mode, setMode] = useState<'merge' | 'replace'>('merge')
	const [restoreSettings, setRestoreSettings] = useState(true)
	const button = (label: string, onPress: () => void, selected = false) => (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled: busy, selected }}
			disabled={busy}
			onPress={onPress}
			style={{
				minHeight: 48,
				padding: 14,
				borderRadius: 10,
				backgroundColor: selected ? colors.primary : colors.surfaceElevated,
			}}
		>
			<Text style={{ color: selected ? '#fff' : colors.primary, fontWeight: '600' }}>{label}</Text>
		</Pressable>
	)
	const exportBackup = async () => {
		setBusy(true)
		const file = new File(Paths.cache, `ZhMusic-backup-${Date.now()}.json`)
		try {
			const text = JSON.stringify(createMusicBackup(Constants.expoConfig?.version ?? ''), null, 2)
			parseMusicBackup(text)
			file.create()
			file.write(text)
			await shareLocalFiles([file.uri])
		} catch {
			Alert.alert(i18n.t('backup.exportFailed'))
		} finally {
			try {
				if (file.exists) file.delete()
			} catch {
				/* Cache cleanup must not block another export. */
			}
			setBusy(false)
		}
	}
	const selectBackup = async () => {
		setBusy(true)
		try {
			const result = await DocumentPicker.getDocumentAsync({
				type: ['application/json', 'text/plain'],
				copyToCacheDirectory: true,
			})
			if (result.canceled) return
			const file = new File(result.assets[0].uri)
			if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds size limit')
			setBackup(parseMusicBackup(await file.text()))
		} catch {
			setBackup(null)
			Alert.alert(i18n.t('backup.invalid'))
		} finally {
			setBusy(false)
		}
	}
	const restore = async () => {
		if (!backup) return
		setBusy(true)
		try {
			const library = restoreMusicBackup(backup, mode, restoreSettings)
			useLibraryStore.setState({ favorites: library.favorites })
			playListsStore.setValue(library.playlists)
			recentlyPlayedStore.setValue(library.recentlyPlayed)
			if (restoreSettings) {
				const settings = backup.settings
				if (settings['music.quality'] !== undefined)
					myTrackPlayer.setQuality(settings['music.quality'])
				if (settings['music.autoCacheLocal'] !== undefined)
					myTrackPlayer.toggleAutoCacheLocal(settings['music.autoCacheLocal'])
				if (settings['music.autoCacheWifiOnly'] !== undefined)
					myTrackPlayer.toggleAutoCacheWifiOnly(settings['music.autoCacheWifiOnly'])
				if (settings['music.isCachedIconVisible'] !== undefined)
					myTrackPlayer.toggleIsCachedIconVisible(settings['music.isCachedIconVisible'])
				if (settings['music.songsNumsToLoad'] !== undefined)
					songsNumsToLoadStore.setValue(settings['music.songsNumsToLoad'])
				if (settings['app.themeMode'] !== undefined) setThemeMode(settings['app.themeMode'])
				if (settings['app.language'] !== undefined) changeLanguage(settings['app.language'])
			}
			setBackup(null)
			Alert.alert(i18n.t('backup.restored'))
		} catch {
			Alert.alert(i18n.t('backup.restoreFailed'))
		} finally {
			setBusy(false)
		}
	}
	const confirmRestore = () =>
		Alert.alert(
			i18n.t('backup.confirmTitle'),
			i18n.t(mode === 'replace' ? 'backup.replaceMessage' : 'backup.mergeMessage'),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('backup.restore'),
					style: mode === 'replace' ? 'destructive' : 'default',
					onPress: () => void restore(),
				},
			],
		)
	return (
		<ScrollView
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, gap: 16 }}
		>
			<Text style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>
				{i18n.t('backup.title')}
			</Text>
			<Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 21 }}>
				{i18n.t('backup.description')}
			</Text>
			{button(i18n.t('backup.export'), () => void exportBackup())}
			{button(i18n.t('backup.import'), () => void selectBackup())}
			{busy ? <ActivityIndicator color={colors.primary} /> : null}
			{backup ? (
				<View style={{ gap: 14 }}>
					<Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
						{i18n.t('backup.preview')}
					</Text>
					<Text style={{ color: colors.textMuted, lineHeight: 22 }}>
						{i18n.t('backup.summary', {
							favorites: backup.library.favorites.length,
							playlists: backup.library.playlists.length,
							recent: backup.library.recentlyPlayed.length,
							settings: Object.keys(backup.settings).length,
						})}
					</Text>
					<Text style={{ color: colors.textMuted, fontSize: 12 }}>
						{backup.createdAt} · {backup.appVersion}
					</Text>
					{button(i18n.t('backup.merge'), () => setMode('merge'), mode === 'merge')}
					{button(i18n.t('backup.replace'), () => setMode('replace'), mode === 'replace')}
					<View
						style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
					>
						<Text style={{ color: colors.text }}>{i18n.t('backup.restoreSettings')}</Text>
						<Switch
							disabled={busy}
							value={restoreSettings}
							onValueChange={setRestoreSettings}
							accessibilityLabel={i18n.t('backup.restoreSettings')}
						/>
					</View>
					{button(i18n.t('backup.restore'), confirmRestore)}
				</View>
			) : null}
		</ScrollView>
	)
}
