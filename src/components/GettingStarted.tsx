import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native'
import { router } from 'expo-router'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import myTrackPlayer, { musicApiSelectedStore } from '@/helpers/trackPlayerIndex'
import i18n from '@/utils/i18n'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function GettingStarted() {
	const colors = useThemeColors()
	const { top } = useSafeAreaInsets()
	const completed = PersistStatus.useValue('app.onboardingCompleted', false)
	const source = musicApiSelectedStore.useValue()
	const [testing, setTesting] = useState(false)
	const [failed, setFailed] = useState(false)
	if (completed) return null
	const action = (label: string, onPress: () => void, disabled = false) => (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}
		>
			<Text style={{ color: disabled ? colors.textMuted : colors.primary }}>{label}</Text>
		</Pressable>
	)
	const test = async () => {
		if (!source || testing) return
		setTesting(true)
		setFailed(false)
		try {
			await myTrackPlayer.testMusicApiById(source.id)
		} catch {
			setFailed(true)
		} finally {
			setTesting(false)
		}
	}
	const usable = source?.health?.status === 'normal' || source?.health?.status === 'partial'
	return (
		<ScrollView
			style={{ maxHeight: 300, flexGrow: 0, backgroundColor: colors.surfaceElevated }}
			contentContainerStyle={{ padding: 16, paddingTop: top + 16, gap: 4 }}
		>
			<Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
				{i18n.t('onboarding.title')}
			</Text>
			<Text style={{ color: colors.textMuted }}>{i18n.t('onboarding.description')}</Text>
			{action(
				i18n.t('onboarding.configure', { source: source?.name ?? i18n.t('onboarding.noSource') }),
				() => router.push('/(modals)/settingModal'),
				testing,
			)}
			{action(i18n.t('onboarding.test'), () => void test(), !source || testing)}
			{testing ? <ActivityIndicator color={colors.primary} /> : null}
			{usable ? <Text style={{ color: colors.success }}>{i18n.t('onboarding.ready')}</Text> : null}
			{failed || source?.health?.status === 'dead' ? (
				<Text style={{ color: colors.error }}>{i18n.t('onboarding.failed')}</Text>
			) : null}
			{action(
				i18n.t('onboarding.search'),
				() => {
					PersistStatus.set('app.onboardingCompleted', true)
					router.navigate('/(tabs)/search')
				},
				testing,
			)}
			{action(
				i18n.t('onboarding.dismiss'),
				() => PersistStatus.set('app.onboardingCompleted', true),
				testing,
			)}
		</ScrollView>
	)
}
