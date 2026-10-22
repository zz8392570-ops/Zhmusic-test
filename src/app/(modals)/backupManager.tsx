import {
	createMusicBackup,
	parseMusicBackup,
	restoreMusicBackup,
	MAX_BACKUP_BYTES,
	MusicBackup,
} from '@/helpers/musicBackup'
import {
	downloadWebDavBackup,
	listWebDavSnapshots,
	type WebDavSnapshot,
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
import PersistStatus from '@/store/PersistStatus'
import { recordWebDavBackupFailure, recordWebDavBackupSuccess } from '@/helpers/webDavBackupStatus'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import { useEffect, useRef, useState } from 'react'
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
	const [canCancel, setCanCancel] = useState(false)
	const activeRequest = useRef<AbortController | null>(null)
	const filePickerActive = useRef(false)
	const scrollRef = useRef<ScrollView>(null)
	const [fileImportStatus, setFileImportStatus] = useState('')
	const mounted = useRef(true)
	useEffect(() => {
		mounted.current = true
		return () => {
			mounted.current = false
			activeRequest.current?.abort()
		}
	}, [])
	const [mode, setMode] = useState<'merge' | 'replace'>('merge')
	const [restoreSettings, setRestoreSettings] = useState(true)
	const [webDavUrl, setWebDavUrl] = useState('')
	const [webDavUsername, setWebDavUsername] = useState('')
	const [webDavPassword, setWebDavPassword] = useState('')
	const [webDavRemotePath, setWebDavRemotePath] = useState(DEFAULT_REMOTE_PATH)
	const [retentionDays, setRetentionDays] = useState<0 | 30 | 90>(30)
	const [webDavStatus, setWebDavStatus] = useState('')
	const [snapshots, setSnapshots] = useState<WebDavSnapshot[] | null>(null)
	const [previewSource, setPreviewSource] = useState('')
	const backupStatus = PersistStatus.useValue('backup.webdavStatus')
	const showBackupPreview = (value: MusicBackup, source: string) => {
		if (!mounted.current) return
		setBackup(value)
		setPreviewSource(source)
		setFileImportStatus('')
		scrollRef.current?.scrollTo({ y: 0, animated: true })
	}

	useEffect(() => {
		let mounted = true
		void loadWebDavBackupConfig()
			.then((config) => {
				if (!mounted || !config) return
				setWebDavUrl(config.url)
				setWebDavUsername(config.username)
				setWebDavPassword(config.password)
				setWebDavRemotePath(config.remotePath)
				setRetentionDays(config.retentionDays ?? 0)
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
		retentionDays,
	})
	const webDavErrorMessage = (error: unknown) => {
		const code = (error as { code?: WebDavErrorCode })?.code
		if (code === 'invalid-config') return i18n.t('backup.webdavInvalidConfig')
		if (code === 'https-required') return i18n.t('backup.httpsRequired')
		if (code === 'unauthorized') return i18n.t('backup.webdavUnauthorized')
		if (code === 'directory-not-found') return i18n.t('backup.webdavDirectoryNotFound')
		if (code === 'backup-not-found') return i18n.t('backup.webdavBackupNotFound')
		if (code === 'not-found') return i18n.t('backup.webdavNotFound')
		if (code === 'too-large') return i18n.t('backup.webdavTooLarge')
		if (code === 'invalid-backup') return i18n.t('backup.webdavInvalidBackup')
		if (code === 'invalid-listing') return i18n.t('backup.invalidListing')
		if (code === 'timeout') return i18n.t('backup.webdavTimeout')
		if (code === 'cancelled') return i18n.t('backup.cancelled')
		const status = (error as { status?: number })?.status
		return status
			? i18n.t('backup.webdavRequestFailedStatus', { status })
			: i18n.t('backup.webdavRequestFailed')
	}
	const runWebDavAction = async (
		action: (config: WebDavBackupConfig, signal: AbortSignal) => Promise<void>,
		cancellable = false,
	) => {
		if (activeRequest.current || filePickerActive.current) return
		const controller = new AbortController()
		activeRequest.current = controller
		setCanCancel(cancellable)
		setBusy(true)
		setWebDavStatus('')
		try {
			const config = await saveWebDavBackupConfig(webDavConfig())
			if (controller.signal.aborted) {
				if (mounted.current) setWebDavStatus(i18n.t('backup.cancelled'))
				return
			}
			setWebDavUrl(config.url)
			setWebDavUsername(config.username)
			setWebDavRemotePath(config.remotePath)
			await action(config, controller.signal)
		} catch (error) {
			if (!mounted.current) return
			const message = webDavErrorMessage(error)
			setWebDavStatus(message)
			if (!controller.signal.aborted) Alert.alert(i18n.t('backup.webdavErrorTitle'), message)
		} finally {
			activeRequest.current = null
			if (mounted.current) {
				setCanCancel(false)
				setBusy(false)
			}
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
			try {
				await uploadWebDavBackupSnapshots(
					config,
					createMusicBackup(Constants.expoConfig?.version ?? ''),
				)
				recordWebDavBackupSuccess()
			} catch (error) {
				recordWebDavBackupFailure(error)
				throw error
			}
			setWebDavStatus(i18n.t('backup.webdavUploadSuccess'))
		})
	const downloadWebDav = () =>
		void runWebDavAction(async (config, signal) => {
			setBackup(null)
			setFileImportStatus('')
			const downloaded = await downloadWebDavBackup(config, undefined, signal)
			if (signal.aborted) return
			showBackupPreview(downloaded, i18n.t('backup.latestSnapshot'))
			setWebDavStatus(i18n.t('backup.webdavDownloadSuccess'))
		}, true)
	const listSnapshots = () =>
		void runWebDavAction(async (config, signal) => {
			setSnapshots(null)
			const listed = await listWebDavSnapshots(config, signal)
			if (!signal.aborted) setSnapshots(listed)
		}, true)
	const selectSnapshot = (date: string) =>
		void runWebDavAction(async (config, signal) => {
			setBackup(null)
			setFileImportStatus('')
			const downloaded = await downloadWebDavBackup(config, date, signal)
			if (signal.aborted) return
			showBackupPreview(downloaded, date)
			setWebDavStatus(i18n.t('backup.webdavDownloadSuccess'))
		}, true)
	useEffect(() => {
		setSnapshots(null)
	}, [webDavUrl, webDavUsername, webDavPassword, webDavRemotePath])
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
		if (busy || filePickerActive.current || activeRequest.current) return
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
		if (busy || filePickerActive.current || activeRequest.current) return
		filePickerActive.current = true
		setFileImportStatus('backup.choosingFile')
		setBusy(true)
		let failureMessage = 'backup.pickerFailed'
		try {
			const result = await DocumentPicker.getDocumentAsync({
				type: ['application/json', 'text/plain', 'application/octet-stream'],
				copyToCacheDirectory: true,
				multiple: false,
			})
			if (!mounted.current) return
			if (result.canceled) {
				setFileImportStatus('')
				return
			}
			failureMessage = 'backup.readFailed'
			const asset = result.assets[0]
			if (!asset?.uri) throw new Error('No selected backup file')
			setFileImportStatus('backup.readingFile')
			const file = new File(asset.uri)
			if ((asset.size ?? 0) > MAX_BACKUP_BYTES || file.size > MAX_BACKUP_BYTES) {
				failureMessage = 'backup.invalid'
				throw new Error('Backup exceeds size limit')
			}
			const text = await file.text()
			if (!mounted.current) return
			failureMessage = 'backup.invalid'
			const parsed = parseMusicBackup(text)
			showBackupPreview(parsed, asset.name)
			setFileImportStatus('backup.fileReady')
		} catch {
			if (!mounted.current) return
			setBackup(null)
			setPreviewSource('')
			setFileImportStatus(failureMessage)
			Alert.alert(i18n.t(failureMessage))
		} finally {
			filePickerActive.current = false
			if (mounted.current) setBusy(false)
		}
	}
	const restore = async () => {
		if (!backup || busy || filePickerActive.current || activeRequest.current) return
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
			setFileImportStatus('')
			Alert.alert(
				i18n.t('backup.restored'),
				i18n.t('backup.restoredCounts', {
					favorites: library.favorites.length,
					playlists: library.playlists.length,
					recent: library.recentlyPlayed.length,
				}),
			)
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
				accessibilityLabel={label}
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
				ref={scrollRef}
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
				{fileImportStatus ? (
					<View style={{ gap: 8 }}>
						{filePickerActive.current ? <ActivityIndicator color={colors.primary} /> : null}
						<Text accessibilityLiveRegion="polite" style={{ color: colors.textMuted }}>
							{i18n.t(fileImportStatus)}
						</Text>
					</View>
				) : null}
				{backup ? (
					<View style={{ gap: 14 }}>
						<Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>
							{i18n.t('backup.preview')}
						</Text>
						<Text style={{ color: colors.success }}>{i18n.t('backup.validationPassed')}</Text>
						<Text style={{ color: colors.textMuted }}>{previewSource}</Text>
						<Text style={{ color: colors.textMuted }}>{i18n.t('backup.restoreFilesNote')}</Text>
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
				<View style={{ height: 1, backgroundColor: colors.surfaceElevated, marginVertical: 4 }} />
				<Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>
					{i18n.t('backup.webdavTitle')}
				</Text>
				<Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
					{i18n.t('backup.webdavDescription')}
				</Text>
				<View style={{ gap: 8 }} accessibilityLiveRegion="polite">
					<Text style={{ color: colors.textMuted }}>
						{i18n.t('backup.lastSuccess', {
							time: backupStatus?.lastSuccessAt
								? new Date(backupStatus.lastSuccessAt).toLocaleString()
								: i18n.t('backup.never'),
						})}
					</Text>
					{backupStatus?.errorCode ? (
						<Text style={{ color: colors.error }}>
							{i18n.t('backup.autoFailed', {
								reason: webDavErrorMessage({ code: backupStatus.errorCode }),
							})}
						</Text>
					) : null}
				</View>
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
				<Text style={{ color: colors.text, fontWeight: '600' }}>{i18n.t('backup.retention')}</Text>
				<View style={{ flexDirection: 'row', gap: 8 }}>
					{([30, 90, 0] as const).map((days) => (
						<View key={days} style={{ flex: 1 }}>
							{button(
								i18n.t(days === 0 ? 'backup.keepForever' : 'backup.keepDays', { days }),
								() => setRetentionDays(days),
								retentionDays === days,
							)}
						</View>
					))}
				</View>
				<View style={{ flexDirection: 'row', gap: 10 }}>
					<View style={{ flex: 1 }}>{button(i18n.t('backup.webdavSave'), saveWebDav)}</View>
					<View style={{ flex: 1 }}>{button(i18n.t('backup.webdavTest'), testWebDav)}</View>
				</View>
				{button(i18n.t('backup.webdavUpload'), uploadWebDav)}
				{backupStatus?.errorCode ? button(i18n.t('backup.retryNow'), uploadWebDav) : null}
				{button(i18n.t('backup.webdavDownload'), downloadWebDav)}
				{button(i18n.t('backup.snapshotHistory'), listSnapshots)}
				{snapshots !== null ? (
					<View style={{ gap: 8 }}>
						<Text style={{ color: colors.textMuted }}>{i18n.t('backup.historyDescription')}</Text>
						{snapshots.length === 0 ? (
							<Text style={{ color: colors.textMuted }}>{i18n.t('backup.noSnapshots')}</Text>
						) : null}
						{snapshots.map((snapshot) => (
							<View key={snapshot.date}>
								{button(i18n.t('backup.previewSnapshot', { date: snapshot.date }), () =>
									selectSnapshot(snapshot.date),
								)}
								{snapshot.sizeBytes !== undefined ? (
									<Text style={{ color: colors.textMuted }}>
										{(snapshot.sizeBytes / 1024).toFixed(1)} KB
									</Text>
								) : null}
							</View>
						))}
					</View>
				) : null}
				{busy ? <ActivityIndicator color={colors.primary} /> : null}
				{canCancel ? (
					<Pressable
						accessibilityRole="button"
						onPress={() => activeRequest.current?.abort()}
						style={{ padding: 14 }}
					>
						<Text style={{ color: colors.primary, textAlign: 'center' }}>
							{i18n.t('find.cancel')}
						</Text>
					</Pressable>
				) : null}
				{webDavStatus ? (
					<Text style={{ color: colors.text, textAlign: 'center', fontSize: 13 }}>
						{webDavStatus}
					</Text>
				) : null}
			</ScrollView>
		</KeyboardAvoidingView>
	)
}
