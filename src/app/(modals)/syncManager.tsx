import { clearLxSyncCredentials, syncWithLxServer } from '@/helpers/sync/lxSyncClient'
import type { LxSyncMode } from '@/helpers/sync/lxSyncTypes'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'
import { useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
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

export default function SyncManagerScreen() {
	const colors = useThemeColors()
	const savedHost = PersistStatus.useValue('sync.host', '') ?? ''
	const credentials = PersistStatus.useValue('sync.credentials')
	const lastSuccessAt = PersistStatus.useValue('sync.lastSuccessAt')
	const [host, setHost] = useState(savedHost)
	const [authCode, setAuthCode] = useState('')
	const [mode, setMode] = useState<LxSyncMode>('merge_local_remote')
	const [busy, setBusy] = useState(false)
	const [status, setStatus] = useState('')
	const lastSuccess = useMemo(
		() => (lastSuccessAt ? new Date(lastSuccessAt).toLocaleString() : i18n.t('sync.never')),
		[lastSuccessAt],
	)

	const runSync = async () => {
		if (!host.trim()) {
			Alert.alert(i18n.t('sync.errorTitle'), i18n.t('sync.hostRequired'))
			return
		}
		if (!credentials && !authCode.trim()) {
			Alert.alert(i18n.t('sync.errorTitle'), i18n.t('sync.codeRequired'))
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
					clearLxSyncCredentials()
					setStatus('')
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

	const button = (label: string, onPress: () => void, destructive = false) => (
		<Pressable
			accessibilityRole="button"
			disabled={busy}
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
						placeholder={credentials ? i18n.t('sync.pairedPlaceholder') : i18n.t('sync.codePlaceholder')}
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
						{credentials ? i18n.t('sync.paired') : i18n.t('sync.firstPairing')}
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

				{button(i18n.t('sync.syncNow'), requestSync)}
				{busy ? <ActivityIndicator color={colors.primary} /> : null}
				{status ? <Text style={{ color: colors.text, textAlign: 'center' }}>{status}</Text> : null}
				<Text style={{ color: colors.textMuted, textAlign: 'center', fontSize: 12 }}>
					{i18n.t('sync.lastSuccess', { time: lastSuccess })}
				</Text>
				{credentials ? button(i18n.t('sync.clearPairing'), clearPairing, true) : null}
			</ScrollView>
		</KeyboardAvoidingView>
	)
}
