import { Pressable, ScrollView, Text } from 'react-native'
import { router } from 'expo-router'
import PersistStatus from '@/store/PersistStatus'
import { useThemeColors } from '@/hooks/useAppTheme'
import { musicApiSelectedStore } from '@/helpers/trackPlayerIndex'
import i18n from '@/utils/i18n'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function GettingStarted() {
	const colors = useThemeColors()
	const { top } = useSafeAreaInsets()
	const completed = PersistStatus.useValue('app.onboardingCompleted', false)
	const source = musicApiSelectedStore.useValue()
	if (completed) return null
	const action = (label: string, onPress: () => void) => (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }}
		>
			<Text style={{ color: colors.primary }}>{label}</Text>
		</Pressable>
	)
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
				() => router.push('/(modals)/sourceSetup'),
			)}
			{action(i18n.t('sourceSetup.local'), () => {
				PersistStatus.set('app.onboardingCompleted', true)
				router.navigate('/(tabs)/favorites/localMusic')
			})}
			{action(i18n.t('onboarding.dismiss'), () =>
				PersistStatus.set('app.onboardingCompleted', true),
			)}
		</ScrollView>
	)
}
