import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { musicApiSelectedStore, musicApiStore } from '@/helpers/trackPlayerIndex'
import {
	importMusicSourceFromFile,
	importMusicSourceFromUrl,
	sourceFileImportProgress,
} from '@/helpers/userApi/sourceImportActions'
import { isSourceUsable, testAndSelectSource } from '@/helpers/userApi/sourceSetup'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'

export default function SourceSetupScreen() {
	const colors = useThemeColors()
	const { bottom } = useSafeAreaInsets()
	const sources = musicApiStore.useValue() ?? []
	const selected = musicApiSelectedStore.useValue()
	const progress = sourceFileImportProgress.useValue()
	const [candidateId, setCandidateId] = useState<string | null>(null)
	const [verifiedId, setVerifiedId] = useState<string | null>(null)
	const [testing, setTesting] = useState(false)
	const [failed, setFailed] = useState(false)
	const operation = useRef<AbortController | null>(null)
	useEffect(() => () => operation.current?.abort(), [])
	const candidate =
		sources.find((api) => api.id === candidateId) ??
		sources.find((api) => api.id === selected?.id) ??
		sources[0]
	const busy = testing || progress !== null
	const ready =
		verifiedId === candidate?.id && selected?.id === candidate?.id && isSourceUsable(selected)
	const test = async () => {
		if (!candidate || operation.current || progress !== null) return
		const controller = new AbortController()
		operation.current = controller
		setTesting(true)
		setFailed(false)
		setVerifiedId(null)
		try {
			const success = await testAndSelectSource(candidate.id, controller.signal)
			if (controller.signal.aborted) return
			setVerifiedId(success ? candidate.id : null)
			setFailed(!success)
		} catch {
			if (!controller.signal.aborted) setFailed(true)
		} finally {
			if (!controller.signal.aborted) {
				operation.current = null
				setTesting(false)
			}
		}
	}
	const finish = (destination: '/(tabs)/search' | '/(tabs)/favorites/localMusic') => {
		if (busy || (destination === '/(tabs)/search' && !ready)) return
		PersistStatus.set('app.onboardingCompleted', true)
		router.dismissTo(destination)
	}
	const heading = (text: string) => (
		<Text style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 16 }}>
			{text}
		</Text>
	)
	return (
		<ScrollView
			style={{ backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, paddingBottom: bottom + 24, gap: 8 }}
		>
			<Text style={{ color: colors.textMuted }}>{i18n.t('sourceSetup.description')}</Text>
			{heading(i18n.t('sourceSetup.importStep'))}
			<Button
				title={i18n.t('settings.actions.import.fromFile')}
				disabled={busy}
				onPress={() => void importMusicSourceFromFile()}
			/>
			<Button
				title={i18n.t('settings.actions.import.fromUrl')}
				disabled={busy}
				onPress={importMusicSourceFromUrl}
			/>
			{progress ? (
				<Text accessibilityLiveRegion="polite" style={{ color: colors.textMuted }}>
					{i18n.t(
						progress.total ? 'sourceImport.batchProgress' : 'sourceImport.importing',
						progress,
					)}
				</Text>
			) : null}
			{heading(i18n.t('sourceSetup.testStep'))}
			{sources.length === 0 ? (
				<Text style={{ color: colors.textMuted }}>{i18n.t('settings.sourceHealth.empty')}</Text>
			) : null}
			{sources.map((api) => (
				<Pressable
					key={api.id}
					accessibilityRole="radio"
					accessibilityState={{ checked: candidate?.id === api.id, disabled: busy }}
					disabled={busy}
					onPress={() => {
						setCandidateId(api.id)
						setFailed(false)
						setVerifiedId(null)
					}}
					style={{
						minHeight: 52,
						padding: 14,
						borderRadius: 12,
						backgroundColor:
							candidate?.id === api.id ? colors.surfaceElevated : colors.surfaceMuted,
					}}
				>
					<Text style={{ color: colors.text }}>
						{candidate?.id === api.id ? '● ' : '○ '}
						{api.name}
					</Text>
				</Pressable>
			))}
			<Button
				title={i18n.t('sourceSetup.testAndUse')}
				disabled={busy || !candidate}
				onPress={() => void test()}
			/>
			{testing ? <ActivityIndicator color={colors.primary} /> : null}
			{failed ? (
				<Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>
					{i18n.t('sourceSetup.failed')}
				</Text>
			) : null}
			{ready ? (
				<Text accessibilityLiveRegion="polite" style={{ color: colors.success }}>
					{i18n.t('sourceSetup.ready', { source: selected?.name })}
				</Text>
			) : null}
			{heading(i18n.t('sourceSetup.searchStep'))}
			<Button
				title={i18n.t('sourceSetup.search')}
				disabled={busy || !ready}
				onPress={() => finish('/(tabs)/search')}
			/>
			<Button
				title={i18n.t('sourceSetup.local')}
				disabled={busy}
				onPress={() => finish('/(tabs)/favorites/localMusic')}
			/>
		</ScrollView>
	)
}
