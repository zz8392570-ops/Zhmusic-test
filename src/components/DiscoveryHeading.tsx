import { useThemeColors } from '@/hooks/useAppTheme'
import { Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ReactNode } from 'react'

export default function DiscoveryHeading({ title, action }: { title: string; action?: ReactNode }) {
	const colors = useThemeColors()
	const { top } = useSafeAreaInsets()
	return (
		<View
			style={{
				paddingTop: top + 12,
				paddingBottom: 18,
				paddingHorizontal: 18,
				flexDirection: 'row',
				alignItems: 'center',
				justifyContent: 'space-between',
				flexShrink: 0,
			}}
		>
			<Text style={{ color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: '800' }}>
				{title}
			</Text>
			{action}
		</View>
	)
}
