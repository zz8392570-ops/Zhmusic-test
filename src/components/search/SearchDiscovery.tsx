import { formatHotSearchScore, type HotSearchItem } from '@/helpers/hotSearch'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ThemeColors } from '@/constants/tokens'
import { useThemeColors } from '@/hooks/useAppTheme'
import { hapticSelection } from '@/utils/haptics'
import i18n from '@/utils/i18n'
import { useMemo } from 'react'
import { Image } from 'expo-image'

type SearchDiscoveryProps = {
	history: string[]
	hotSearches: HotSearchItem[]
	hotSearchTitle: string
	hotRankOffset: number
	canChangeHotSearch: boolean
	isHotLoading: boolean
	hasHotError: boolean
	onSearch: (keyword: string) => void
	onRemoveHistory: (keyword: string) => void
	onClearHistory: () => void
	onRetryHotSearch: () => void
	onChangeHotSearch: () => void
}

const SearchDiscovery = ({
	history,
	hotSearches,
	hotSearchTitle,
	hotRankOffset,
	canChangeHotSearch,
	isHotLoading,
	hasHotError,
	onSearch,
	onRemoveHistory,
	onClearHistory,
	onRetryHotSearch,
	onChangeHotSearch,
}: SearchDiscoveryProps) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])

	return (
		<ScrollView
			style={styles.container}
			contentContainerStyle={styles.content}
			keyboardShouldPersistTaps="handled"
			showsVerticalScrollIndicator={false}
		>
			{history.length > 0 ? (
				<View style={styles.section}>
					<View style={styles.sectionHeader}>
						<Text style={styles.sectionTitle}>{i18n.t('find.history')}</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={i18n.t('find.clearHistory')}
							hitSlop={8}
							onPress={onClearHistory}
							style={({ pressed }) => pressed && styles.pressed}
						>
							<MaterialCommunityIcons name="trash-can-outline" size={22} color={colors.textMuted} />
						</Pressable>
					</View>
					<View style={styles.chipList}>
						{history.map((keyword, index) => (
							<View key={`${keyword}-${index}`} style={styles.historyChip}>
								<Pressable
									accessibilityRole="button"
									onPress={() => onSearch(keyword)}
									onLongPress={() => onRemoveHistory(keyword)}
									style={({ pressed }) => [styles.historyLabelButton, pressed && styles.pressed]}
								>
									<MaterialCommunityIcons name="clock-outline" size={17} color={colors.textMuted} />
									<Text style={styles.historyLabel} numberOfLines={1}>
										{keyword}
									</Text>
								</Pressable>
							</View>
						))}
					</View>
				</View>
			) : null}

			<View style={styles.section}>
				<View style={styles.sectionHeader}>
					<Text style={styles.sectionTitle}>{hotSearchTitle}</Text>
					{!isHotLoading && !hasHotError && canChangeHotSearch ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={i18n.t('find.changeBatch')}
							hitSlop={8}
							onPress={() => {
								hapticSelection()
								onChangeHotSearch()
							}}
							style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}
						>
							<MaterialCommunityIcons name="refresh" size={16} color={colors.primary} />
							<Text style={styles.clearText}>{i18n.t('find.changeBatch')}</Text>
						</Pressable>
					) : null}
				</View>
				{isHotLoading ? (
					<View style={styles.statusRow}>
						<ActivityIndicator size="small" color={colors.loading} />
						<Text style={styles.statusText}>{i18n.t('find.loadingHotSearch')}</Text>
					</View>
				) : hasHotError ? (
					<Pressable
						accessibilityRole="button"
						onPress={onRetryHotSearch}
						style={({ pressed }) => [styles.errorCard, pressed && styles.pressed]}
					>
						<MaterialCommunityIcons name="refresh" size={20} color={colors.primary} />
						<View style={styles.errorContent}>
							<Text style={styles.errorTitle}>{i18n.t('find.hotSearchFailed')}</Text>
							<Text style={styles.statusText}>{i18n.t('find.tapToRetry')}</Text>
						</View>
					</Pressable>
				) : (
					<View style={styles.hotList}>
						{hotSearches.map((item, index) => (
							<Pressable
								key={`${item.platform}-${item.keyword}`}
								accessibilityRole="button"
								onPress={() => onSearch(item.keyword)}
								style={({ pressed }) => [styles.hotItem, pressed && styles.pressed]}
							>
								<Text
									style={[
										styles.rank,
										{
											color:
												hotRankOffset + index < 3
													? ['#fc3c44', '#ff784d', '#e8b550'][hotRankOffset + index]
													: colors.textMuted,
										},
									]}
								>
									{hotRankOffset + index + 1}
								</Text>
								<Text style={styles.hotKeyword} numberOfLines={1}>
									{item.keyword}
								</Text>
								{item.badgeUrl ? (
									<Image
										source={{ uri: item.badgeUrl }}
										contentFit="contain"
										style={{ width: 24, height: 16, marginLeft: 6 }}
									/>
								) : item.badgeText ? (
									<Text
										numberOfLines={1}
										style={{ color: colors.primary, fontSize: 11, maxWidth: 40, marginLeft: 6 }}
									>
										{item.badgeText}
									</Text>
								) : null}
								<View style={styles.heat}>
									<Text style={styles.heatPlatform}>
										{i18n.t(getMusicPlatformLabelKey(item.platform))}
									</Text>
									<MaterialCommunityIcons name="fire" size={15} color={colors.textMuted} />
									<Text style={styles.heatText}>
										{formatHotSearchScore(item.score) || i18n.t('find.trending')}
									</Text>
								</View>
							</Pressable>
						))}
					</View>
				)}
			</View>
		</ScrollView>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		heat: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 10 },
		heatText: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
		heatPlatform: { color: colors.textMuted, fontSize: 10, marginRight: 3 },
		content: {
			paddingHorizontal: 18,
			paddingTop: 12,
			paddingBottom: 140,
		},
		section: {
			marginBottom: 18,
		},
		sectionHeader: {
			minHeight: 32,
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		sectionTitle: {
			color: colors.text,
			fontSize: 22,
			fontWeight: '700',
			marginBottom: 10,
		},
		clearText: {
			color: colors.primary,
			fontSize: 14,
			marginBottom: 10,
		},
		sectionAction: {
			minHeight: 32,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 4,
		},
		chipList: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: 8,
		},
		historyChip: {
			maxWidth: '100%',
			minHeight: 36,
			flexDirection: 'row',
			alignItems: 'center',
			borderRadius: 18,
			backgroundColor: colors.surfaceMuted,
		},
		historyLabelButton: {
			minHeight: 36,
			maxWidth: 220,
			justifyContent: 'center',
			flexDirection: 'row',
			alignItems: 'center',
			gap: 7,
			paddingLeft: 13,
			paddingRight: 13,
		},
		historyLabel: {
			color: colors.text,
			fontSize: 14,
		},
		removeButton: {
			width: 32,
			height: 36,
			alignItems: 'center',
			justifyContent: 'center',
		},
		hotList: { gap: 0 },
		hotItem: {
			width: '100%',
			minHeight: 46,
			flexDirection: 'row',
			alignItems: 'center',
			borderBottomWidth: StyleSheet.hairlineWidth,
			borderBottomColor: colors.separator,
		},
		rank: {
			width: 32,
			color: colors.textMuted,
			fontSize: 18,
			fontWeight: '700',
		},
		topRank: {
			color: colors.primary,
		},
		hotKeyword: {
			flex: 1,
			color: colors.text,
			fontSize: 16,
		},
		statusRow: {
			minHeight: 64,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 10,
		},
		statusText: {
			color: colors.textMuted,
			fontSize: 13,
		},
		errorCard: {
			minHeight: 64,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 10,
			paddingHorizontal: 14,
			borderRadius: 12,
			backgroundColor: colors.surfaceMuted,
		},
		errorContent: {
			gap: 3,
		},
		errorTitle: {
			color: colors.text,
			fontSize: 14,
			fontWeight: '600',
		},
		pressed: {
			opacity: 0.6,
		},
	})

export default SearchDiscovery
