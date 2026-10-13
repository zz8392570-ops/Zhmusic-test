import { getSmartPlaylistTracks, type SmartPlaylistKind } from '@/helpers/listeningStats'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import i18n from '@/utils/i18n'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { Pressable, ScrollView, Text, View } from 'react-native'

const kinds: SmartPlaylistKind[] = ['frequent', 'mostPlayed', 'recentlyAdded', 'forgotten']

export default function SmartPlaylistsScreen() {
	const colors = useThemeColors()
	const records = PersistStatus.useValue('music.listeningStats', []) ?? []
	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 18, paddingBottom: 150, gap: 12 }}
		>
			{kinds.map((kind, index) => (
				<Pressable
					key={kind}
					onPress={() =>
						router.push({ pathname: '/(tabs)/favorites/smartPlaylist', params: { kind } })
					}
					style={({ pressed }) => ({
						flexDirection: 'row',
						alignItems: 'center',
						padding: 16,
						gap: 14,
						borderRadius: 16,
						backgroundColor: colors.surfaceElevated,
						opacity: pressed ? 0.7 : 1,
					})}
				>
					<View
						style={{
							width: 46,
							height: 46,
							borderRadius: 14,
							backgroundColor: colors.overlaySoft,
							justifyContent: 'center',
							alignItems: 'center',
						}}
					>
						<Ionicons
							name={(['radio', 'podium', 'sparkles', 'time'] as const)[index]}
							size={25}
							color={colors.primary}
						/>
					</View>
					<View style={{ flex: 1 }}>
						<Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>
							{i18n.t(`listeningStats.smart.${kind}`)}
						</Text>
						<Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 5 }}>
							{i18n.t('library.shortSongCount', {
								count: getSmartPlaylistTracks(kind, records).length,
							})}
						</Text>
						<Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 5 }}>
							{i18n.t(`listeningStats.smartDescriptions.${kind}`)}
						</Text>
					</View>
					<Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
				</Pressable>
			))}
		</ScrollView>
	)
}
