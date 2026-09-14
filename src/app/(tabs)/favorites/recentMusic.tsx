import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors, screenPadding } from '@/constants/tokens'
import { importedLocalMusicStore, recentlyPlayedStore } from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import type { Track } from '@/player/types'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

type Filter = 'all' | 'offline'
type Sort = 'recent' | 'title' | 'artist'

const RecentMusicScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors), [colors])
	const recentValue = recentlyPlayedStore.useValue()
	const localValue = importedLocalMusicStore.useValue()
	const recent = useMemo(() => recentValue || [], [recentValue])
	const local = useMemo(() => localValue || [], [localValue])
	const [filter, setFilter] = useState<Filter>('all')
	const [sort, setSort] = useState<Sort>('recent')
	const localKeys = useMemo(
		() => new Set(local.map((track) => `${track.platform}:${track.id}`)),
		[local],
	)
	const tracks = useMemo(() => {
		const filtered =
			filter === 'all'
				? recent
				: recent.filter(
						(track) =>
							localKeys.has(`${track.platform}:${track.id}`) ||
							String(track.url).startsWith('file:'),
					)
		if (sort === 'recent') return filtered
		return [...filtered].sort((a, b) =>
			String(a[sort] || '').localeCompare(String(b[sort] || ''), i18n.locale),
		)
	}, [filter, localKeys, recent, sort])
	const playlist = {
		id: 'recent',
		name: i18n.t('appTab.recentlyPlayed'),
		title: i18n.t('appTab.recentlyPlayed'),
		coverImg: tracks[0]?.artwork || unknownTrackImageUri,
		tracks: tracks as Track[],
	} as Playlist

	return (
		<View style={defaultStyles.container}>
			<View style={styles.controls}>
				{(['all', 'offline'] as const).map((item) => (
					<Pressable
						key={item}
						accessibilityRole="button"
						accessibilityState={{ selected: filter === item }}
						onPress={() => setFilter(item)}
						style={[styles.chip, filter === item && styles.activeChip]}
					>
						<Text style={[styles.chipText, filter === item && styles.activeText]}>
							{i18n.t(`library.filters.${item}`)}
						</Text>
					</Pressable>
				))}
				<View style={styles.spacer} />
				{(['recent', 'title', 'artist'] as const).map((item) => (
					<Pressable
						key={item}
						accessibilityRole="button"
						accessibilityState={{ selected: sort === item }}
						onPress={() => setSort(item)}
						style={[styles.chip, sort === item && styles.activeChip]}
					>
						<Text style={[styles.chipText, sort === item && styles.activeText]}>
							{i18n.t(`library.sort.${item}`)}
						</Text>
					</Pressable>
				))}
			</View>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<PlaylistTracksList playlist={playlist} tracks={tracks as Track[]} />
			</ScrollView>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		controls: {
			alignItems: 'center',
			flexDirection: 'row',
			gap: 6,
			paddingHorizontal: 16,
			paddingVertical: 8,
		},
		chip: {
			backgroundColor: colors.surfaceMuted,
			borderRadius: 13,
			paddingHorizontal: 9,
			paddingVertical: 6,
		},
		activeChip: { backgroundColor: colors.primary },
		chipText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
		activeText: { color: '#fff' },
		spacer: { flex: 1 },
	})

export default RecentMusicScreen
