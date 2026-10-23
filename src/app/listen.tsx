import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router'
import { executePersonalLink } from '@/helpers/personalLinks'
import { LibraryToolButton as Button } from '@/components/LibraryToolButton'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
export default function ListenLinkScreen() {
	const params = useLocalSearchParams<{ action?: string; id?: string }>(),
		colors = useThemeColors()
	const consumed = useRef<{ key: string; controller: AbortController; completed: boolean } | null>(
		null,
	)
	const [status, setStatus] = useState<'opening' | 'playing' | 'cancelled' | 'linkFailed'>(
		'opening',
	)
	useFocusEffect(
		useCallback(() => {
			if (consumed.current?.controller.signal.aborted && !consumed.current.completed)
				setStatus('cancelled')
			return () => consumed.current?.controller.abort()
		}, []),
	)
	useEffect(() => {
		const key = JSON.stringify([params.action, params.id])
		if (
			consumed.current?.key === key &&
			(!consumed.current.controller.signal.aborted || consumed.current.completed)
		)
			return
		const controller = new AbortController(),
			request = { key, controller, completed: false }
		consumed.current = request
		setStatus('opening')
		void executePersonalLink(params.action, params.id, controller.signal)
			.then((result) => {
				if (controller.signal.aborted) return
				request.completed = true
				setStatus(result ? 'playing' : 'cancelled')
				if (result) router.push('/player')
			})
			.catch((error) => {
				if (!controller.signal.aborted) {
					request.completed = true
					setStatus('linkFailed')
					Alert.alert(i18n.t('personalFeatures.sceneFailed'), (error as Error).message)
				}
			})
		return () => controller.abort()
	}, [params.action, params.id])
	return (
		<View
			style={{ flex: 1, backgroundColor: colors.background, padding: 20, justifyContent: 'center' }}
		>
			<Text accessibilityLiveRegion="polite" style={{ color: colors.text, fontSize: 20 }}>
				{i18n.t(`personalFeatures.${status}`)}
			</Text>
			<Button
				title={i18n.t('personalFeatures.openPlayer')}
				disabled={status === 'opening'}
				onPress={() => router.push('/player')}
			/>
			<Button
				title={i18n.t('appTab.favorites')}
				onPress={() => router.replace('/(tabs)/favorites')}
			/>
			<Button
				title={i18n.t('personalFeatures.tools')}
				onPress={() => router.push('/(modals)/personalTools' as any)}
			/>
		</View>
	)
}
