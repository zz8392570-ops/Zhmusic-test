import { useThemeColors } from '@/hooks/useAppTheme'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReactNode } from 'react'

export default function DiscoveryHeading({
	title,
	action,
	large = false,
}: {
	title: string
	action?: ReactNode
	large?: boolean
}) {
	const colors = useThemeColors()
	const { top } = useSafeAreaInsets()
	return (
		<View
			style={{
				paddingTop: top + 2,
				paddingBottom: 6,
				paddingHorizontal: 18,
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				flexShrink: 0,
			}}
		>
			<Text
				style={{
					color: colors.text,
					fontSize: large ? 34 : 28,
					lineHeight: large ? 42 : 34,
					fontWeight: '800',
				}}
			>
				{title}
			</Text>
			{action}
		</View>
	)
}
