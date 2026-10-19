import PersistStatus from '@/store/PersistStatus'
import { playListsStore } from '@/helpers/trackPlayerIndex'
import { getImportedPlaylistSource } from '@/helpers/importPlaylist'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'

export default function PlaylistRefreshScreen() {
	const colors = useThemeColors()
	const days = PersistStatus.useValue('library.autoRefresh', 0) ?? 0
	const statuses = PersistStatus.useValue('library.refreshStatus', {}) ?? {}
	const playlists = (playListsStore.useValue() ?? []).filter((item) =>
		getImportedPlaylistSource(item),
	)
	return (
		<ScrollView
			style={{ flex: 1, backgroundColor: colors.background }}
			contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 48 }}
		>
			<Text style={{ color: colors.textMuted, lineHeight: 21 }}>
				{i18n.t('playlistAutoRefresh.description')}
			</Text>
			<View style={{ flexDirection: 'row', gap: 12 }}>
				{([0, 1, 7] as const).map((value) => (
					<Pressable
						key={value}
						accessibilityRole="button"
						accessibilityState={{ selected: days === value }}
						onPress={() => {
							try {
								PersistStatus.set('library.autoRefresh', value)
							} catch {
								Alert.alert(i18n.t('playlistTools.updateFailed'))
							}
						}}
						style={{
							flex: 1,
							padding: 14,
							borderRadius: 12,
							backgroundColor: value === days ? colors.primary : colors.surfaceElevated,
						}}
					>
						<Text style={{ color: days === value ? '#fff' : colors.text, textAlign: 'center' }}>
							{i18n.t(`playlistAutoRefresh.interval${value}`)}
						</Text>
					</Pressable>
				))}
			</View>
			{playlists.length ? (
				playlists.map((playlist) => (
					<View
						key={playlist.id}
						style={{ paddingVertical: 14, borderBottomWidth: 0.5, borderColor: colors.separator }}
					>
						<Text style={{ color: colors.text, fontSize: 16 }}>{playlist.name}</Text>
						<Text style={{ color: colors.textMuted, marginTop: 8 }}>
							{statuses[playlist.id]?.error
								? i18n.t('playlistAutoRefresh.failed')
								: statuses[playlist.id]
									? i18n.t('playlistAutoRefresh.summary', {
											added: statuses[playlist.id].added ?? 0,
											removed: statuses[playlist.id].removed ?? 0,
											preserved: 0,
										})
									: i18n.t('playlistAutoRefresh.notChecked')}
						</Text>
						{statuses[playlist.id] ? (
							<Text style={{ color: colors.textMuted, marginTop: 6 }}>
								{new Date(statuses[playlist.id].checkedAt).toLocaleString()}
							</Text>
						) : null}
					</View>
				))
			) : (
				<Text style={{ color: colors.textMuted }}>{i18n.t('playlistAutoRefresh.empty')}</Text>
			)}
		</ScrollView>
	)
}
