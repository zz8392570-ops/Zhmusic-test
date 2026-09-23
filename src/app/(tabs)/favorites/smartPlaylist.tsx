import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { unknownTrackImageUri } from '@/constants/images'
import { screenPadding, type ThemeColors } from '@/constants/tokens'
import {
	clearListeningStats,
	getSmartPlaylistTracks,
	setListeningStatsEnabled,
	type SmartPlaylistKind,
} from '@/helpers/listeningStats'
import type { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useLocalSearchParams } from 'expo-router'
import { useMemo } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'

const kinds: SmartPlaylistKind[] = ['frequent', 'mostPlayed', 'recentlyAdded', 'forgotten']

const SmartPlaylistScreen = () => {
	const params = useLocalSearchParams<{ kind?: string }>()
	const kind = kinds.includes(params.kind as SmartPlaylistKind)
		? (params.kind as SmartPlaylistKind)
		: 'frequent'
	const statsValue = PersistStatus.useValue('music.listeningStats', [])
	const enabledValue = PersistStatus.useValue('music.listeningStatsEnabled', true)
	const enabled = enabledValue !== false
	const stats = useMemo(() => statsValue ?? [], [statsValue])
	const tracks = useMemo(() => getSmartPlaylistTracks(kind, stats), [kind, stats])
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const defaultStyles = useDefaultStyles()
	const totalSeconds = stats.reduce((total, item) => total + item.totalSeconds, 0)
	const playlist = {
		id: `smart:${kind}`,
		name: kind,
		title: i18n.t(`listeningStats.smart.${kind}`),
		description: i18n.t(`listeningStats.smartDescriptions.${kind}`),
		coverImg: tracks[0]?.artwork || unknownTrackImageUri,
		tracks,
	} as Playlist
	const clear = () =>
		Alert.alert(i18n.t('listeningStats.clearTitle'), i18n.t('listeningStats.clearMessage'), [
			{ text: i18n.t('listeningStats.cancel'), style: 'cancel' },
			{ text: i18n.t('listeningStats.clear'), style: 'destructive', onPress: clearListeningStats },
		])

	return (
		<View style={defaultStyles.container}>
			<View style={styles.settings}>
				<View style={styles.settingText}>
					<Text style={styles.settingTitle}>{i18n.t('listeningStats.enabled')}</Text>
					<Text style={styles.settingDescription}>{i18n.t('listeningStats.privateHint')}</Text>
				</View>
				<Switch value={enabled} onValueChange={setListeningStatsEnabled} />
				<Pressable onPress={clear} accessibilityRole="button">
					<Text style={styles.clear}>{i18n.t('listeningStats.clear')}</Text>
				</Pressable>
			</View>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<PlaylistTracksList
					playlist={playlist}
					tracks={tracks}
					showMetadata
					metadata={i18n.t('listeningStats.summary', {
						count: stats.length,
						hours: (totalSeconds / 3600).toFixed(1),
					})}
				/>
			</ScrollView>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		settings: {
			alignItems: 'center',
			borderBottomColor: colors.border,
			borderBottomWidth: StyleSheet.hairlineWidth,
			flexDirection: 'row',
			gap: 12,
			paddingHorizontal: 16,
			paddingVertical: 10,
		},
		settingText: { flex: 1 },
		settingTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
		settingDescription: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
		clear: { color: colors.primary, fontSize: 13, fontWeight: '600' },
	})

export default SmartPlaylistScreen
