import {
	createMusicBackup,
	parseMusicBackup,
	restoreMusicBackup,
	MAX_BACKUP_BYTES,
	MusicBackup,
} from '@/helpers/musicBackup'
import {
	downloadWebDavBackup,
	loadWebDavBackupConfig,
	saveWebDavBackupConfig,
	testWebDavConnection,
	uploadWebDavBackupSnapshots,
	type WebDavBackupConfig,
	type WebDavErrorCode,
} from '@/helpers/webDavBackup'
import myTrackPlayer, { playListsStore, recentlyPlayedStore } from '@/helpers/trackPlayerIndex'
import { useThemeColors, useThemeMode } from '@/hooks/useAppTheme'
import { useLibraryStore } from '@/store/library'
import { songsNumsToLoadStore } from '@/player/PlayerStore'
import i18n, { changeLanguage } from '@/utils/i18n'
import { shareLocalFiles } from '../../../modules/cymusic-native/sharing'
import Constants from 'expo-constants'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { useEffect, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Switch,
	Text,
	TextInput,
	View,
} from 'react-native'

const DEFAULT_REMOTE_PATH = 'Zhmusic/Backups/latest.json'

export default function BackupManagerScreen() {
	const colors = useThemeColors()
	const { setThemeMode } = useThemeMode()
	const [backup, setBackup] = useState<MusicBackup | null>(null)
	const [busy, setBusy] = useState(false)
	const [mode, setMode] = useState<'merge' | 'replace'>('merge')
	const [restoreSettings, setRestoreSettings] = useState(true)
	const [webDavUrl, setWebDavUrl] = useState('')
	const [webDavUsername, setWebDavUsername] = useState('')
	const [webDavPassword, setWebDavPassword] = useState('')
	const [webDavRemotePath, setWebDavRemotePath] = useState(DEFAULT_REMOTE_PATH)
	const [webDavStatus, setWebDavStatus] = useState('')

	useEffect(() => {
		let mounted = true
		void loadWebDavBackupConfig()
			.then((config) => {
				if (!mounted || !config) return
				setWebDavUrl(config.url)
				setWebDavUsername(config.username)
				setWebDavPassword(config.password)
				setWebDavRemotePath(config.remotePath)
			})
			.catch(() => {
				if (mounted) setWebDavStatus(i18n.t('backup.webdavInvalidConfig'))
			})
		return () => {
			mounted = false
		}
	}, [])

	const webDavConfig = (): WebDavBackupConfig => ({
		url: webDavUrl,
		username: webDavUsername,
		password: webDavPassword,
		remotePath: webDavRemotePath,
	})
	const webDavErrorMessage = (error: unknown) => {
		const code = (error as { code?: WebDavErrorCode })?.code
		if (code === 'invalid-config') return i18n.t('backup.webdavInvalidConfig')
		if (code === 'unauthorized') return i18n.t('backup.webdavUnauthorized')
		if (code === 'directory-not-found') return i18n.t('backup.webdavDirectoryNotFound')
		if (code === 'backup-not-found') return i18n.t('backup.webdavBackupNotFound')
		if (code === 'not-found') return i18n.t('backup.webdavNotFound')
		if (code === 'too-large') return i18n.t('backup.webdavTooLarge')
		if (code === 'invalid-backup') return i18n.t('backup.webdavInvalidBackup')
		if (code === 'timeout') return i18n.t('backup.webdavTimeout')
		const status = (error as { status?: number })?.status
		return status
			? i18n.t('backup.webdavRequestFailedStatus', { status })
			: i18n.t('backup.webdavRequestFailed')
	}
	const runWebDavAction = async (action: (config: WebDavBackupConfig) => Promise<void>) => {
		setBusy(true)
		setWebDavStatus('')
		try {
			const config = await saveWebDavBackupConfig(webDavConfig())
			setWebDavUrl(config.url)
			setWebDavUsername(config.username)
			setWebDavRemotePath(config.remotePath)
			await action(config)
		} catch (error) {
			const message = webDavErrorMessage(error)
			setWebDavStatus(message)
			Alert.alert(i18n.t('backup.webdavErrorTitle'), message)
		} finally {
			setBusy(false)
		}
	}
	const saveWebDav = () =>
		void runWebDavAction(async () => setWebDavStatus(i18n.t('backup.webdavSaved')))
	const testWebDav = () =>
		void runWebDavAction(async (config) => {
			await testWebDavConnection(config)
			setWebDavStatus(i18n.t('backup.webdavConnectionSuccess'))
		})
	const uploadWebDav = () =>
		void runWebDavAction(async (config) => {
				await uploadWebDavBackupSnapshots(
					config,
					createMusicBackup(Constants.expoConfig?.version ?? ''),
				)
			setWebDavStatus(i18n.t('backup.webdavUploadSuccess'))
		})
	const downloadWebDav = () =>
		void runWebDavAction(async (config) => {
			setBackup(await downloadWebDavBackup(config))
			setWebDavStatus(i18n.t('backup.webdavDownloadSuccess'))
		})
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
	const input = (
		label: string,
		value: string,
		onChangeText: (value: string) => void,
		options: {
			placeholder?: string
			secureTextEntry?: boolean
			keyboardType?: 'url' | 'default'
		} = {},
	) => (
		<View style={{ gap: 8 }}>
			<Text style={{ color: colors.text, fontWeight: '600' }}>{label}</Text>
			<TextInput
				autoCapitalize="none"
				autoCorrect={false}
				editable={!busy}
				keyboardType={options.keyboardType}
				onChangeText={onChangeText}
				placeholder={options.placeholder}
				placeholderTextColor={colors.textMuted}
				secureTextEntry={options.secureTextEntry}
				style={{
					minHeight: 48,
					borderRadius: 10,
					paddingHorizontal: 14,
					backgroundColor: colors.surfaceElevated,
					color: colors.text,
				}}
				value={value}
			/>
		</View>
	)
	return (
		<KeyboardAvoidingView
			style={{ flex: 1, backgroundColor: colors.background }}
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
		>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 16 }}
			>
				<Text style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>
					{i18n.t('backup.title')}
				</Text>
				<Text style={{ color: colors.textMuted, fontSize: 14, lineHeight: 21 }}>
					{i18n.t('backup.description')}
				</Text>
				{button(i18n.t('backup.export'), () => void exportBackup())}
				{button(i18n.t('backup.import'), () => void selectBackup())}
				<View style={{ height: 1, backgroundColor: colors.surfaceElevated, marginVertical: 4 }} />
				<Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
					{i18n.t('backup.webdavTitle')}
				</Text>
				<Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
					{i18n.t('backup.webdavDescription')}
				</Text>
				{input(i18n.t('backup.webdavUrl'), webDavUrl, setWebDavUrl, {
					placeholder: 'https://dav.example.com/remote.php/dav/files/user/Backups',
					keyboardType: 'url',
				})}
				{input(i18n.t('backup.webdavUsername'), webDavUsername, setWebDavUsername)}
				{input(i18n.t('backup.webdavPassword'), webDavPassword, setWebDavPassword, {
					secureTextEntry: true,
				})}
				{input(i18n.t('backup.webdavRemotePath'), webDavRemotePath, setWebDavRemotePath, {
					placeholder: DEFAULT_REMOTE_PATH,
				})}
				<Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
					{i18n.t('backup.webdavSecurityNote')}
				</Text>
				<View style={{ flexDirection: 'row', gap: 10 }}>
					<View style={{ flex: 1 }}>{button(i18n.t('backup.webdavSave'), saveWebDav)}</View>
					<View style={{ flex: 1 }}>{button(i18n.t('backup.webdavTest'), testWebDav)}</View>
				</View>
				{button(i18n.t('backup.webdavUpload'), uploadWebDav)}
				{button(i18n.t('backup.webdavDownload'), downloadWebDav)}
				{busy ? <ActivityIndicator color={colors.primary} /> : null}
				{webDavStatus ? (
					<Text style={{ color: colors.text, textAlign: 'center', fontSize: 13 }}>
						{webDavStatus}
					</Text>
				) : null}
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
							style={{
								flexDirection: 'row',
								justifyContent: 'space-between',
								alignItems: 'center',
							}}
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
		</KeyboardAvoidingView>
	)
}
