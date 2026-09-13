import { ThemeColors } from '@/constants/tokens'
import type { SearchPlatform } from '@/helpers/crossPlatformSearch'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { memo, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'

type SearchPlatformSelectorProps = {
	value: SearchPlatform
	onChange: (platform: SearchPlatform) => void
}

const PLATFORMS: { id: SearchPlatform; label: string }[] = [
	{ id: 'all', label: 'find.platformAll' },
	{ id: 'tx', label: 'find.platformTx' },
	{ id: 'kw', label: 'find.platformKw' },
	{ id: 'kg', label: 'find.platformKg' },
	{ id: 'wy', label: 'find.platformWy' },
	{ id: 'mg', label: 'find.platformMg' },
]

const SearchPlatformSelector = ({ value, onChange }: SearchPlatformSelectorProps) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])

	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={styles.content}
			style={styles.container}
		>
			{PLATFORMS.map((platform) => {
				const selected = platform.id === value
				return (
					<Pressable
						key={platform.id}
						accessibilityRole="button"
						accessibilityState={{ selected }}
						onPress={() => onChange(platform.id)}
						style={({ pressed }) => [
							styles.chip,
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

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: {
			flexGrow: 0,
		},
		content: {
			minHeight: 42,
			alignItems: 'center',
			gap: 8,
			paddingHorizontal: 16,
			paddingBottom: 6,
		},
		chip: {
			minHeight: 30,
			justifyContent: 'center',
			paddingHorizontal: 13,
			borderRadius: 15,
			backgroundColor: colors.surfaceMuted,
		},
		selectedChip: {
			backgroundColor: colors.primary,
		},
		label: {
			color: colors.textMuted,
			fontSize: 13,
			fontWeight: '500',
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
