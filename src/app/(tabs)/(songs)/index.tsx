import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { TracksList } from '@/components/TracksList'
import DiscoveryHeading from '@/components/DiscoveryHeading'
import ChartCard from '@/components/ChartCard'
import { Ionicons } from '@expo/vector-icons'
import { screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import {
	DEFAULT_HOME_BOARD_ID,
	DEFAULT_HOME_SOURCE,
	fetchRadioPlaylists,
	getBoardSongs,
	mapLeaderboardTrack,
	normalizeLeaderboardSource,
	setHomeLeaderboard,
} from '@/helpers/leaderboard'
import { generateTracksListId } from '@/helpers/miscellaneous'
import myTrackPlayer, { songsNumsToLoadStore } from '@/helpers/trackPlayerIndex'
import type { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'

const boardIdOf = (playlist: Playlist) => playlist.id.split('__').slice(1).join('__')

const SongsScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const source = normalizeLeaderboardSource(
		PersistStatus.useValue('music.homeBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const boardId = String(
		PersistStatus.useValue('music.homeBoardId', DEFAULT_HOME_BOARD_ID) ?? DEFAULT_HOME_BOARD_ID,
	)
	const songsNumsToLoad = songsNumsToLoadStore.useValue()
	const [boards, setBoards] = useState<Playlist[]>([])
	const [tracks, setTracks] = useState<Track[]>([])
	const [loadingBoards, setLoadingBoards] = useState(true)
	const [loadingTracks, setLoadingTracks] = useState(true)
	const [failed, setFailed] = useState(false)
	const boardRequest = useRef(0)
	const trackRequest = useRef(0)

	const selectedBoard = useMemo(
		() => boards.find((board) => boardIdOf(board) === boardId) ?? boards[0],
		[boardId, boards],
	)
	const visibleTracks = useMemo(
		() => tracks.slice(0, Math.max(1, songsNumsToLoad || tracks.length)),
		[songsNumsToLoad, tracks],
	)

	const loadBoards = useCallback(async () => {
		const requestId = ++boardRequest.current
		setLoadingBoards(true)
		try {
			const result = await fetchRadioPlaylists(source)
			if (requestId !== boardRequest.current) return
			setBoards(result)
			const preferredBoardId = String(
				PersistStatus.get('music.homeBoardId') ?? DEFAULT_HOME_BOARD_ID,
			)
			const selected = result.find((item) => boardIdOf(item) === preferredBoardId) ?? result[0]
			if (selected && boardIdOf(selected) !== preferredBoardId) {
				setHomeLeaderboard(source, boardIdOf(selected))
			}
		} finally {
			if (requestId === boardRequest.current) setLoadingBoards(false)
		}
	}, [source])

	const loadTracks = useCallback(async () => {
		if (!boardId) return
		const requestId = ++trackRequest.current
		setLoadingTracks(true)
		setFailed(false)
		try {
			const result = await getBoardSongs(source, boardId, 1)
			if (requestId !== trackRequest.current) return
			setTracks((result.list ?? []).map((item) => mapLeaderboardTrack(item, source)))
		} catch (error) {
			console.error('Failed to fetch leaderboard:', error)
			if (requestId === trackRequest.current) setFailed(true)
		} finally {
			if (requestId === trackRequest.current) setLoadingTracks(false)
		}
	}, [boardId, source])

	useEffect(() => {
		setBoards([])
		void loadBoards()
		return () => {
			boardRequest.current += 1
		}
	}, [loadBoards])

	useEffect(() => {
		setTracks([])
		void loadTracks()
		return () => {
			trackRequest.current += 1
		}
	}, [loadTracks])

	const refresh = useCallback(async () => {
		await Promise.all([loadBoards(), loadTracks()])
	}, [loadBoards, loadTracks])

	return (
		<View style={defaultStyles.container}>
			<DiscoveryHeading
				title={i18n.t('appTab.songs')}
				action={
					<Pressable
						onPress={() => void refresh()}
						accessibilityLabel={i18n.t('home.retry')}
						style={{ padding: 8 }}
					>
						<Ionicons name="refresh-outline" size={27} color={colors.textMuted} />
					</Pressable>
				}
			/>
			<SearchPlatformSelector
				includeAll={false}
				inset={screenPadding.horizontal}
				value={source}
				onChange={(platform) => setHomeLeaderboard(platform as MusicPlatform)}
			/>
			{loadingBoards && !boards.length ? (
				<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
					<ActivityIndicator size="large" color={colors.loading} />
				</View>
			) : (
				<ScrollView
					contentInsetAdjustmentBehavior="automatic"
					refreshControl={
						<RefreshControl
							refreshing={loadingTracks}
							onRefresh={refresh}
							tintColor={colors.primary}
						/>
					}
					contentContainerStyle={{ paddingBottom: 0 }}
				>
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						contentContainerStyle={{
							paddingHorizontal: screenPadding.horizontal,
							paddingTop: 4,
							paddingBottom: 22,
							gap: 12,
						}}
					>
						{boards.map((board) => (
							<ChartCard
								key={board.id}
								board={board}
								selected={boardIdOf(board) === boardId}
								onPress={() => setHomeLeaderboard(source, boardIdOf(board))}
							/>
						))}
					</ScrollView>

					<View style={{ paddingHorizontal: screenPadding.horizontal }}>
						{failed && !tracks.length ? (
							<View style={{ alignItems: 'center', paddingVertical: 80 }}>
								<Text style={{ color: colors.textMuted, fontSize: 16 }}>
									{i18n.t('home.loadFailed')}
								</Text>
								<Pressable onPress={() => void loadTracks()} style={{ padding: 14 }}>
									<Text style={{ color: colors.primary, fontWeight: '600' }}>
										{i18n.t('home.retry')}
									</Text>
								</Pressable>
							</View>
						) : loadingTracks && !tracks.length ? (
							<View style={{ alignItems: 'center', paddingVertical: 80 }}>
								<ActivityIndicator color={colors.loading} />
							</View>
						) : (
							<TracksList
								id={generateTracksListId('charts', `${source}_${boardId}`)}
								tracks={visibleTracks}
								scrollEnabled={false}
								showRank
								hideQueueControls
								ListHeaderComponent={
									<View
										style={{
											marginBottom: 18,
											flexDirection: 'row',
											alignItems: 'center',
											justifyContent: 'space-between',
											gap: 10,
										}}
									>
										<View style={{ flex: 1 }}>
											<Text style={{ color: colors.text, fontSize: 23, fontWeight: '800' }}>
												{selectedBoard?.title || i18n.t('appTab.songs')}
											</Text>
											<Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 5 }}>
												{i18n.t('charts.trackCount', { count: visibleTracks.length })}
											</Text>
										</View>
										<Pressable
											disabled={!visibleTracks.length}
											onPress={() =>
												void myTrackPlayer.playWithReplacePlayList(
													visibleTracks[0] as IMusic.IMusicItem,
													visibleTracks as IMusic.IMusicItem[],
												)
											}
											style={{
												backgroundColor: colors.primary,
												flexDirection: 'row',
												alignItems: 'center',
												gap: 6,
												borderRadius: 22,
												paddingHorizontal: 15,
												paddingVertical: 11,
											}}
										>
											<Ionicons name="play" size={18} color="#fff" />
											<Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
												{i18n.t('charts.playAll')}
											</Text>
										</Pressable>
									</View>
								}
							/>
						)}
					</View>
				</ScrollView>
			)}
		</View>
	)
}

export default SongsScreen
