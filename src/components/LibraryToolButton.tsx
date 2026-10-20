import { Pressable, Text } from 'react-native'
import { useThemeColors } from '@/hooks/useAppTheme'
export const LibraryToolButton = ({
	title,
	onPress,
	disabled = false,
	danger = false,
}: {
	title: string
	onPress: () => void
	disabled?: boolean
	danger?: boolean
}) => {
	const colors = useThemeColors()
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={{
				padding: 14,
				borderRadius: 12,
				backgroundColor: colors.surfaceMuted,
				opacity: disabled ? 0.4 : 1,
				marginVertical: 4,
			}}
		>
			<Text style={{ color: danger ? colors.error : colors.primary }}>{title}</Text>
		</Pressable>
	)
}
