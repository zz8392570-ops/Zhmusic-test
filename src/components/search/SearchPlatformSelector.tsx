import { ThemeColors } from '@/constants/tokens'
import type { SearchPlatform } from '@/helpers/crossPlatformSearch'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { memo, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { hapticSelection } from '@/utils/haptics'

type SearchPlatformSelectorProps = {
	value: SearchPlatform
	onChange: (platform: SearchPlatform) => void
	includeAll?: boolean
	inset?: number
	solid?: boolean
}

const PLATFORMS: { id: SearchPlatform; label: string }[] = [
	{ id: 'all', label: 'find.platformAll' },
	{ id: 'tx', label: 'find.platformTx' },
	{ id: 'wy', label: 'find.platformWy' },
	{ id: 'kg', label: 'find.platformKg' },
	{ id: 'kw', label: 'find.platformKw' },
	{ id: 'mg', label: 'find.platformMg' },
]

const SearchPlatformSelector = ({
	value,
	onChange,
	includeAll = true,
	inset = 16,
	solid = false,
}: SearchPlatformSelectorProps) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors, inset), [colors, inset])
	const platforms = includeAll ? PLATFORMS : PLATFORMS.filter((platform) => platform.id !== 'all')

	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={styles.content}
			style={styles.container}
		>
			{platforms.map((platform) => {
				const selected = platform.id === value
				return (
					<Pressable
						key={platform.id}
						accessibilityRole="button"
						accessibilityLabel={i18n.t(platform.label)}
						accessibilityState={{ selected }}
						onPress={() => {
							hapticSelection()
							onChange(platform.id)
						}}
						style={({ pressed }) => [
							styles.chip,
							solid && { backgroundColor: colors.surfaceMuted },
							selected && styles.selectedChip,
							pressed && styles.pressed,
						]}
					>
						<Text style={[styles.label, selected && styles.selectedLabel]}>
							{i18n.t(platform.label)}
						</Text>
					</Pressable>
				)
			})}
		</ScrollView>
	)
}

const createStyles = (colors: ThemeColors, inset: number) =>
	StyleSheet.create({
		container: {
			flexGrow: 0,
			flexShrink: 0,
			height: 40,
		},
		content: {
			minHeight: 40,
			alignItems: 'center',
			gap: 8,
			paddingHorizontal: inset,
			paddingBottom: 4,
		},
		chip: {
			minHeight: 32,
			justifyContent: 'center',
			paddingHorizontal: 13,
			borderRadius: 18,
			backgroundColor: 'transparent',
		},
		selectedChip: {
			backgroundColor: colors.primary,
		},
		label: {
			color: colors.textMuted,
			fontSize: 13,
			fontWeight: '500',
			lineHeight: 20,
		},
		selectedLabel: {
			color: '#ffffff',
			fontWeight: '600',
		},
		pressed: {
			opacity: 0.62,
		},
	})

export default memo(SearchPlatformSelector)
