import { MaterialCommunityIcons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ThemeColors } from '@/constants/tokens'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { useMemo } from 'react'

type SearchSuggestionsProps = {
	query: string
	suggestions: string[]
	isLoading: boolean
	onSearch: (keyword: string) => void
}

const SearchSuggestions = ({ query, suggestions, isLoading, onSearch }: SearchSuggestionsProps) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const visibleSuggestions = useMemo(() => {
		const normalizedQuery = query.toLocaleLowerCase()
		return suggestions
			.filter((item, index, list) => list.indexOf(item) === index)
			.filter((item) => item.toLocaleLowerCase() !== normalizedQuery)
			.slice(0, 8)
	}, [query, suggestions])

	return (
		<ScrollView
			style={styles.container}
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="always"
			showsVerticalScrollIndicator={false}
		>
			<Pressable
				accessibilityRole="button"
				onPress={() => onSearch(query)}
				style={({ pressed }) => [styles.row, pressed && styles.pressed]}
			>
				<MaterialCommunityIcons name="magnify" size={21} color={colors.primary} />
				<Text style={styles.directSearch} numberOfLines={1}>
					{i18n.t('find.searchFor', { keyword: query })}
				</Text>
				{isLoading ? <ActivityIndicator size="small" color={colors.loading} /> : null}
			</Pressable>

			{visibleSuggestions.map((suggestion) => (
				<View key={suggestion}>
					<View style={styles.separator} />
					<Pressable
						accessibilityRole="button"
						onPress={() => onSearch(suggestion)}
						style={({ pressed }) => [styles.row, pressed && styles.pressed]}
					>
						<MaterialCommunityIcons name="music-note" size={20} color={colors.textMuted} />
						<Text style={styles.suggestion} numberOfLines={1}>
							{suggestion}
						</Text>
						<MaterialCommunityIcons name="arrow-top-left" size={18} color={colors.textMuted} />
					</Pressable>
				</View>
			))}
		</ScrollView>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		content: {
			paddingHorizontal: 16,
			paddingBottom: 140,
		},
		row: {
			minHeight: 50,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 11,
		},
		directSearch: {
			flex: 1,
			color: colors.primary,
			fontSize: 15,
			fontWeight: '600',
		},
		suggestion: {
			flex: 1,
			color: colors.text,
			fontSize: 15,
		},
		separator: {
			height: StyleSheet.hairlineWidth,
			marginLeft: 32,
			backgroundColor: colors.separator,
		},
		pressed: {
			opacity: 0.55,
		},
	})

export default SearchSuggestions
