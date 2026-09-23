import { releaseNotes } from '@/constants/releaseNotes'
import { screenPadding, type ThemeColors } from '@/constants/tokens'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import Constants from 'expo-constants'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

const ReleaseNotesScreen = () => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const defaultStyles = useDefaultStyles()
	const currentVersion = Constants.expoConfig?.version
	return (
		<View style={defaultStyles.container}>
			<ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
				<Text style={styles.title}>{i18n.t('releaseNotes.title')}</Text>
				<Text style={styles.subtitle}>{i18n.t('releaseNotes.subtitle')}</Text>
				{releaseNotes.map((release) => (
					<View key={release.version} style={styles.card}>
						<View style={styles.versionRow}>
							<Text style={styles.version}>v{release.version}</Text>
							{release.version === currentVersion ? (
								<Text style={styles.current}>{i18n.t('releaseNotes.current')}</Text>
							) : null}
							<Text style={styles.date}>{release.date}</Text>
						</View>
						{release.sections.map((section) => (
							<View key={section.type} style={styles.section}>
								<Text style={styles.sectionTitle}>
									{i18n.t(`releaseNotes.sections.${section.type}`)}
								</Text>
								{section.items.map((item) => (
									<Text key={item} style={styles.item}>
										• {item}
									</Text>
								))}
							</View>
						))}
					</View>
				))}
			</ScrollView>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		content: { gap: 16, padding: screenPadding.horizontal, paddingBottom: 40 },
		title: { color: colors.text, fontSize: 28, fontWeight: '800' },
		subtitle: { color: colors.textMuted, fontSize: 14, marginTop: -8 },
		card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16 },
		versionRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
		version: { color: colors.text, fontSize: 20, fontWeight: '800' },
		current: {
			backgroundColor: colors.primary,
			borderRadius: 9,
			color: '#fff',
			fontSize: 10,
			fontWeight: '700',
			overflow: 'hidden',
			paddingHorizontal: 7,
			paddingVertical: 3,
		},
		date: { color: colors.textMuted, flex: 1, fontSize: 12, textAlign: 'right' },
		section: { gap: 5, marginTop: 16 },
		sectionTitle: { color: colors.primary, fontSize: 14, fontWeight: '700' },
		item: { color: colors.text, fontSize: 14, lineHeight: 21 },
	})

export default ReleaseNotesScreen
