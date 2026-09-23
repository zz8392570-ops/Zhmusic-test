import { syncWithLxServer } from '@/helpers/sync/lxSyncClient'
import { clearLxSyncCredentials, getLxSyncCredentials } from '@/helpers/sync/lxSyncCredentials'
import { requestLxAutoSync, stopLxAutoSyncRetries } from '@/helpers/sync/lxAutoSync'
import type { LxSyncMode } from '@/helpers/sync/lxSyncTypes'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
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

const MODES: Array<{ id: LxSyncMode; titleKey: string; descriptionKey: string }> = [
	{
		id: 'merge_local_remote',
		titleKey: 'sync.modeMerge',
		descriptionKey: 'sync.modeMergeDescription',
	},
	{
		id: 'overwrite_local_remote_full',
		titleKey: 'sync.modeUpload',
		descriptionKey: 'sync.modeUploadDescription',
	},
	{
		id: 'overwrite_remote_local_full',
		titleKey: 'sync.modeDownload',
		descriptionKey: 'sync.modeDownloadDescription',
	},
]

const isRemoteHttpHost = (host: string) => {
	try {
		const url = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`)
		if (url.protocol !== 'http:') return false
		const name = url.hostname.toLowerCase()
		if (name === 'localhost' || name.endsWith('.local') || name === '[::1]') return false
		if (/^127\./.test(name) || /^10\./.test(name) || /^192\.168\./.test(name)) return false
		const secondOctet = /^172\.(\d+)\./.exec(name)?.[1]
		return !(secondOctet && Number(secondOctet) >= 16 && Number(secondOctet) <= 31)
	} catch {
		return false
	}
}

export default function SyncManagerScreen() {
	const colors = useThemeColors()
	const savedHost = PersistStatus.useValue('sync.host', '') ?? ''
	const lastSuccessAt = PersistStatus.useValue('sync.lastSuccessAt')
	const autoEnabled = PersistStatus.useValue('sync.autoEnabled', false) === true
	const autoWifiOnly = PersistStatus.useValue('sync.autoWifiOnly', false) === true
	const lastAutoError = PersistStatus.useValue('sync.lastAutoError')
	const [paired, setPaired] = useState(false)
	const [pairingError, setPairingError] = useState(false)
	const [pairingLoaded, setPairingLoaded] = useState(false)
	const [host, setHost] = useState(savedHost)
	const [authCode, setAuthCode] = useState('')
	const [mode, setMode] = useState<LxSyncMode>('merge_local_remote')
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState('')
	const approvedInsecureHost = useRef('')
	const lastSuccess = useMemo(
		() => (lastSuccessAt ? new Date(lastSuccessAt).toLocaleString() : i18n.t('sync.never')),
		[lastSuccessAt],
	)

	useEffect(() => {
		let mounted = true
		void getLxSyncCredentials()
			.then((credentials) => {
				if (mounted) setPaired(!!credentials)
			})
			.catch((error: unknown) => {
				if (mounted) {
					setPairingError(true)
					setStatus(error instanceof Error ? error.message : i18n.t('sync.unknownError'))
				}
			})
			.finally(() => {
				if (mounted) setPairingLoaded(true)
			})
		return () => {
			mounted = false
		}
	}, [])

	const runSync = async () => {
		if (!host.trim()) {
			Alert.alert(i18n.t('sync.errorTitle'), i18n.t('sync.hostRequired'))
			return
		}
		if (!paired && !authCode.trim()) {
			Alert.alert(i18n.t('sync.errorTitle'), i18n.t('sync.codeRequired'))
			return
		}
		if (isRemoteHttpHost(host.trim()) && approvedInsecureHost.current !== host.trim()) {
			Alert.alert(i18n.t('sync.insecureTitle'), i18n.t('sync.insecureMessage'), [
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('sync.continue'),
					onPress: () => {
						approvedInsecureHost.current = host.trim()
						void runSync()
					},
				},
			])
			return
		}
		setBusy(true)
		setStatus(i18n.t('sync.connecting'))
		try {
			const result = await syncWithLxServer({
				host,
				authCode: authCode.trim() || undefined,
				mode,
				onStatus: setStatus,
			})
			setAuthCode('')
			setPaired(true)
			setPairingError(false)
			stopLxAutoSyncRetries()
			PersistStatus.set('sync.lastAutoError', undefined)
			setStatus(i18n.t('sync.successStatus', { server: result.serverName }))
			Alert.alert(i18n.t('sync.successTitle'), i18n.t('sync.successMessage'))
		} catch (error) {
			const message = error instanceof Error ? error.message : i18n.t('sync.unknownError')
			setStatus(message)
			Alert.alert(i18n.t('sync.errorTitle'), message)
		} finally {
			setBusy(false)
		}
	}

	const clearPairing = () => {
		Alert.alert(i18n.t('sync.clearPairing'), i18n.t('sync.clearPairingConfirm'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('sync.clear'),
				style: 'destructive',
				onPress: () => {
					void clearLxSyncCredentials()
						.then(() => {
							setPaired(false)
							setPairingError(false)
							setStatus('')
						})
						.catch((error: unknown) => {
							Alert.alert(
								i18n.t('sync.errorTitle'),
								error instanceof Error ? error.message : i18n.t('sync.unknownError'),
							)
						})
				},
			},
		])
	}
	const requestSync = () => {
		if (mode === 'merge_local_remote') {
			void runSync()
			return
		}
		Alert.alert(i18n.t('sync.overwriteConfirmTitle'), i18n.t('sync.overwriteConfirmMessage'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('sync.continue'),
				style: 'destructive',
				onPress: () => void runSync(),
			},
		])
	}
	const setAutoEnabled = (enabled: boolean) => {
		PersistStatus.set('sync.autoEnabled', enabled)
		if (enabled) requestLxAutoSync()
		else stopLxAutoSyncRetries()
	}

	const button = (label: string, onPress: () => void, destructive = false) => (
		<Pressable
			accessibilityRole="button"
			disabled={busy || !pairingLoaded}
			onPress={onPress}
			style={{
				minHeight: 48,
				alignItems: 'center',
				justifyContent: 'center',
				borderRadius: 12,
				backgroundColor: destructive ? colors.surfaceElevated : colors.primary,
				opacity: busy ? 0.6 : 1,
			}}
		>
			<Text style={{ color: destructive ? '#d64545' : '#fff', fontWeight: '700' }}>{label}</Text>
		</Pressable>
	)

	return (
		<KeyboardAvoidingView
			style={{ flex: 1, backgroundColor: colors.background }}
			behavior={Platform.OS === 'ios' ? 'padding' : undefined}
		>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 18 }}
			>
				<Text style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>
					{i18n.t('sync.title')}
				</Text>
				<Text style={{ color: colors.textMuted, lineHeight: 21 }}>
					{i18n.t('sync.description')}
				</Text>

				<View style={{ gap: 8 }}>
					<Text style={{ color: colors.text, fontWeight: '600' }}>{i18n.t('sync.host')}</Text>
					<TextInput
						autoCapitalize="none"
						autoCorrect={false}
						editable={!busy}
						keyboardType="url"
						onChangeText={setHost}
						placeholder="http://192.168.1.2:9527"
						placeholderTextColor={colors.textMuted}
						style={{
							minHeight: 48,
							borderRadius: 12,
							paddingHorizontal: 14,
							backgroundColor: colors.surfaceElevated,
							color: colors.text,
						}}
						value={host}
					/>
				</View>

				<View style={{ gap: 8 }}>
					<Text style={{ color: colors.text, fontWeight: '600' }}>
						{i18n.t('sync.authCode')}
					</Text>
					<TextInput
						autoCapitalize="none"
						autoCorrect={false}
						editable={!busy}
						onChangeText={setAuthCode}
						placeholder={paired ? i18n.t('sync.pairedPlaceholder') : i18n.t('sync.codePlaceholder')}
						placeholderTextColor={colors.textMuted}
						secureTextEntry
						style={{
							minHeight: 48,
							borderRadius: 12,
							paddingHorizontal: 14,
							backgroundColor: colors.surfaceElevated,
							color: colors.text,
						}}
						value={authCode}
					/>
					<Text style={{ color: colors.textMuted, fontSize: 12 }}>
						{paired ? i18n.t('sync.paired') : i18n.t('sync.firstPairing')}
					</Text>
				</View>

				<View style={{ gap: 10 }}>
					<Text style={{ color: colors.text, fontWeight: '600' }}>{i18n.t('sync.mode')}</Text>
					{MODES.map((item) => {
						const selected = item.id === mode
						return (
							<Pressable
								accessibilityRole="radio"
								accessibilityState={{ checked: selected }}
								disabled={busy}
								key={item.id}
								onPress={() => setMode(item.id)}
								style={{
									padding: 14,
									gap: 5,
									borderRadius: 12,
									borderWidth: 1.5,
									borderColor: selected ? colors.primary : colors.surfaceElevated,
									backgroundColor: colors.surfaceElevated,
								}}
							>
								<Text style={{ color: selected ? colors.primary : colors.text, fontWeight: '700' }}>
									{i18n.t(item.titleKey)}
								</Text>
								<Text style={{ color: colors.textMuted, lineHeight: 19 }}>
									{i18n.t(item.descriptionKey)}
								</Text>
							</Pressable>
						)
					})}
				</View>

				<View style={{ gap: 14, padding: 14, borderRadius: 12, backgroundColor: colors.surfaceElevated }}>
					<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
						<View style={{ flex: 1, paddingRight: 16, gap: 4 }}>
							<Text style={{ color: colors.text, fontWeight: '700' }}>{i18n.t('sync.autoSync')}</Text>
							<Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
								{i18n.t('sync.autoSyncDescription')}
							</Text>
						</View>
						<Switch
							disabled={!paired || busy}
							value={autoEnabled}
							onValueChange={setAutoEnabled}
						/>
					</View>
					<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
						<View style={{ flex: 1, paddingRight: 16, gap: 4 }}>
							<Text style={{ color: colors.text, fontWeight: '600' }}>{i18n.t('sync.wifiOnly')}</Text>
							<Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
								{i18n.t('sync.wifiOnlyDescription')}
							</Text>
						</View>
						<Switch
							disabled={!autoEnabled || busy}
							value={autoWifiOnly}
							onValueChange={(enabled) => {
								PersistStatus.set('sync.autoWifiOnly', enabled)
								requestLxAutoSync()
							}}
						/>
					</View>
					{lastAutoError ? (
						<Text style={{ color: '#d64545', fontSize: 12 }}>
							{i18n.t('sync.autoError', { message: lastAutoError })}
						</Text>
					) : null}
				</View>

				{button(i18n.t('sync.syncNow'), requestSync)}
				{busy ? <ActivityIndicator color={colors.primary} /> : null}
				{status ? <Text style={{ color: colors.text, textAlign: 'center' }}>{status}</Text> : null}
				<Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>
					{i18n.t('sync.lastSuccess', { time: lastSuccess })}
				</Text>
				{paired || pairingError ? button(i18n.t('sync.clearPairing'), clearPairing, true) : null}
			</ScrollView>
		</KeyboardAvoidingView>
	)
}
