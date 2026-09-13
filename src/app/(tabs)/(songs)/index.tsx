import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { TracksList } from '@/components/TracksList'
import { screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import {
	DEFAULT_HOME_BOARD_ID,
	DEFAULT_HOME_SOURCE,
	normalizeLeaderboardSource,
	setHomeLeaderboard,
} from '@/helpers/leaderboard'
import { generateTracksListId } from '@/helpers/miscellaneous'
import { songsNumsToLoadStore } from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { useLibraryStore, useTracks, useTracksLoading } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useCallback } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'

const SongsScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const tracks = useTracks()
	const songsNumsToLoad = songsNumsToLoadStore.useValue()
	const isLoading = useTracksLoading()
	const { fetchTracks } = useLibraryStore()
	const homeBoardId = String(
		PersistStatus.useValue('music.homeBoardId', DEFAULT_HOME_BOARD_ID) ?? DEFAULT_HOME_BOARD_ID,
	)
	const homeBoardSource = normalizeLeaderboardSource(
		PersistStatus.useValue('music.homeBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)

	const handleLoadMore = useCallback(() => {
		fetchTracks()
	}, [fetchTracks])

	return (
		<View style={defaultStyles.container}>
			<SearchPlatformSelector
				includeAll={false}
				inset={screenPadding.horizontal}
				value={homeBoardSource}
				onChange={(platform) => setHomeLeaderboard(platform as MusicPlatform)}
			/>
			{!tracks.length && isLoading ? (
				<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<ActivityIndicator size="large" color={colors.loading} />
				</View>
			) : !tracks.length ? (
				<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<Text style={{ color: colors.textMuted, fontSize: 16 }}>{i18n.t('home.loadFailed')}</Text>
				</View>
			) : (
				<ScrollView
					contentInsetAdjustmentBehavior="automatic"
					style={{ paddingHorizontal: screenPadding.horizontal }}
					onScroll={({ nativeEvent }) => {
						const { layoutMeasurement, contentOffset, contentSize } = nativeEvent
						const paddingToBottom = 60
						const isCloseToBottom =
							layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom

						if (isCloseToBottom) {
							handleLoadMore()
						}
					}}
					scrollEventThrottle={400}
				>
					<TracksList
						id={generateTracksListId('songs', `${homeBoardSource}_${homeBoardId}`)}
						tracks={tracks}
						scrollEnabled={false}
						numsToPlay={songsNumsToLoad}
					/>
					{isLoading && tracks.length > 0 && (
						<View style={{ paddingVertical: 20, alignItems: 'center' }}>
							<ActivityIndicator size="small" color={colors.loading} />
						</View>
					)}
				</ScrollView>
			)}
		</View>
	)
}

export default SongsScreen
