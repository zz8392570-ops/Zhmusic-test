import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { TracksList } from '@/components/TracksList'
import DiscoveryHeading from '@/components/DiscoveryHeading'
import ChartCard from '@/components/ChartCard'
import { Ionicons } from '@expo/vector-icons'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import {
	DEFAULT_HOME_BOARD_ID,
	DEFAULT_HOME_SOURCE,
	fetchRadioPlaylists,
	normalizeLeaderboardSource,
	setHomeLeaderboard,
} from '@/helpers/leaderboard'
import { generateTracksListId } from '@/helpers/miscellaneous'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import {
	appendLeaderboardTracks,
	getFullLeaderboard,
	getLeaderboardPage,
} from '@/helpers/leaderboardPagination'
import type { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import type { Track } from '@/player/types'
import PersistStatus from '@/store/PersistStatus'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Pressable,
	RefreshControl,
	ScrollView,
	Text,
	View,
} from 'react-native'

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
	const [boards, setBoards] = useState<Playlist[]>([])
	const [tracks, setTracks] = useState<Track[]>([])
	const tracksRef = useRef<Track[]>([])
	const failedPage = useRef(1)
	const [loadingBoards, setLoadingBoards] = useState(true)
	const [loadingTracks, setLoadingTracks] = useState(true)
	const [page, setPage] = useState(1)
	const [total, setTotal] = useState(0)
	const [hasMore, setHasMore] = useState(false)
	const paging = useRef(false)
	const [failed, setFailed] = useState(false)
	const [playingBoard, setPlayingBoard] = useState<string | null>(null)
	const playRequest = useRef(0)
	const boardRequest = useRef(0)
	const trackRequest = useRef(0)

	const selectedBoard = useMemo(
		() => boards.find((board) => boardIdOf(board) === boardId) ?? boards[0],
		[boardId, boards],
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
		} catch (error) {
			console.error('Failed to fetch chart catalog:', error)
			if (requestId === boardRequest.current) setFailed(true)
		} finally {
			if (requestId === boardRequest.current) setLoadingBoards(false)
		}
	}, [source])

	const loadTracks = useCallback(
		async (nextPage = 1) => {
			if (!boardId || (nextPage > 1 && paging.current)) return
			const requestId = ++trackRequest.current
			paging.current = true
			setLoadingTracks(true)
			setFailed(false)
			try {
				const result = await getLeaderboardPage(source, boardId, nextPage)
				if (requestId !== trackRequest.current) return
				if (nextPage > 1 && !result.tracks.length) throw new Error('Empty chart page')
				const combined =
					nextPage === 1 ? result.tracks : appendLeaderboardTracks(tracksRef.current, result.tracks)
				if (nextPage > 1 && combined.length === tracksRef.current.length)
					throw new Error('Repeated chart page')
				tracksRef.current = combined
				setTracks(combined)
				setPage(nextPage)
				setTotal(result.total)
				setHasMore(result.hasMore)
			} catch (error) {
				console.error('Failed to fetch leaderboard:', error)
				if (requestId === trackRequest.current) {
					failedPage.current = nextPage
					setFailed(true)
				}
			} finally {
				if (requestId === trackRequest.current) {
					paging.current = false
					setLoadingTracks(false)
				}
			}
		},
		[boardId, source],
	)

	useEffect(() => {
		playRequest.current += 1
		setPlayingBoard(null)
		setBoards([])
		void loadBoards()
		return () => {
			playRequest.current += 1
			boardRequest.current += 1
		}
	}, [loadBoards])

	useEffect(() => {
		tracksRef.current = []
		setTracks([])
		setPage(1)
		setTotal(0)
		setHasMore(false)
		paging.current = false
		void loadTracks()
		return () => {
			trackRequest.current += 1
		}
	}, [loadTracks])

	const refresh = useCallback(async () => {
		await Promise.all([loadBoards(), loadTracks()])
	}, [loadBoards, loadTracks])

	const cancelBoardPlayback = () => {
		playRequest.current += 1
		setPlayingBoard(null)
	}
	const selectBoard = (board: Playlist) => {
		cancelBoardPlayback()
		setHomeLeaderboard(source, boardIdOf(board))
	}
	const playBoard = async (board: Playlist) => {
		const requestId = ++playRequest.current
		const playbackRevision = myTrackPlayer.getPlaybackRevision()
		const isCurrent = () =>
			requestId === playRequest.current &&
			myTrackPlayer.getPlaybackRevision() === playbackRevision &&
			PersistStatus.get('music.homeBoardSource') === source &&
			String(PersistStatus.get('music.homeBoardId')) === boardIdOf(board)
		setPlayingBoard(board.id)
		setHomeLeaderboard(source, boardIdOf(board))
		try {
			const songs = await getFullLeaderboard(source, boardIdOf(board), isCurrent)
			if (!isCurrent()) return
			if (!songs.length) throw new Error('Empty leaderboard')
			await myTrackPlayer.playWithReplacePlayList(
				songs[0] as IMusic.IMusicItem,
				songs as IMusic.IMusicItem[],
			)
		} catch (error) {
			if (isCurrent()) {
				Alert.alert(i18n.t('home.loadFailed'))
				console.error('Failed to play leaderboard:', error)
			}
		} finally {
			if (requestId === playRequest.current) setPlayingBoard(null)
		}
	}

	return (
		<View style={defaultStyles.container}>
			<DiscoveryHeading
				large
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
				inset={18}
				value={source}
				onChange={(platform) => setHomeLeaderboard(platform as MusicPlatform)}
			/>
			{loadingBoards && !boards.length ? (
				<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
					<ActivityIndicator size="large" color={colors.loading} />
				</View>
			) : (
				<TracksList
					id={generateTracksListId('charts', `${source}_${boardId}`)}
					tracks={tracks}
					showRank
					hideQueueControls
					onTrackPress={cancelBoardPlayback}
					contentContainerStyle={{ paddingHorizontal: 18 }}
					contentInsetAdjustmentBehavior="never"
					refreshControl={
						<RefreshControl
							refreshing={loadingTracks}
							onRefresh={() => void refresh()}
							tintColor={colors.primary}
						/>
					}
					ListHeaderComponent={
						<View>
							<ScrollView
								horizontal
								showsHorizontalScrollIndicator={false}
								contentContainerStyle={{ paddingTop: 4, paddingBottom: 12, gap: 12 }}
							>
								{boards.map((board) => (
									<ChartCard
										key={board.id}
										board={board}
										selected={boardIdOf(board) === boardId}
										onPress={() => selectBoard(board)}
										onPlay={() => void playBoard(board)}
										playing={playingBoard === board.id}
									/>
								))}
							</ScrollView>
							<View
								style={{
									marginBottom: 10,
									flexDirection: 'row',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: 10,
								}}
							>
								<View style={{ flex: 1, minWidth: 0 }}>
									<Text style={{ color: colors.text, fontSize: 23, fontWeight: '800' }}>
										{selectedBoard?.title || i18n.t('appTab.songs')}
									</Text>
									<Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 5 }}>
										{selectedBoard?.period ? `${selectedBoard.period} · ` : ''}
										{hasMore
											? i18n.t('charts.loadedCount', { loaded: tracks.length, total })
											: i18n.t('charts.trackCount', { count: tracks.length })}
									</Text>
								</View>
								<Pressable
									disabled={!tracks.length || playingBoard === selectedBoard?.id}
									accessibilityRole="button"
									accessibilityState={{
										busy: playingBoard === selectedBoard?.id,
										disabled: !tracks.length || playingBoard === selectedBoard?.id,
									}}
									onPress={() => selectedBoard && void playBoard(selectedBoard)}
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
									{playingBoard === selectedBoard?.id ? (
										<ActivityIndicator size="small" color="#fff" />
									) : (
										<Ionicons name="play" size={18} color="#fff" />
									)}
									<Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
										{i18n.t('charts.playAll')}
									</Text>
								</Pressable>
							</View>
						</View>
					}
					ListEmptyComponent={
						failed ? (
							<View style={{ alignItems: 'center', paddingVertical: 64 }}>
								<Text style={{ color: colors.textMuted, fontSize: 16 }}>
									{i18n.t('home.loadFailed')}
								</Text>
								<Pressable
									onPress={() => void loadTracks()}
									style={{ padding: 14 }}
									accessibilityRole="button"
								>
									<Text style={{ color: colors.primary, fontWeight: '600' }}>
										{i18n.t('home.retry')}
									</Text>
								</Pressable>
							</View>
						) : loadingTracks ? (
							<View style={{ paddingVertical: 64, alignItems: 'center' }}>
								<ActivityIndicator color={colors.loading} />
							</View>
						) : undefined
					}
					ListFooterComponent={
						tracks.length > 0 && (hasMore || failed) ? (
							<Pressable
								disabled={loadingTracks}
								onPress={() => void loadTracks(failed ? failedPage.current : page + 1)}
								accessibilityRole="button"
								style={{ paddingVertical: 14, alignItems: 'center' }}
							>
								{loadingTracks ? (
									<ActivityIndicator color={colors.primary} />
								) : (
									<Text style={{ color: colors.primary, fontSize: 14, fontWeight: '600' }}>
										{i18n.t(failed ? 'charts.pageFailed' : 'charts.loadMore')}
									</Text>
								)}
							</Pressable>
						) : null
					}
				/>
			)}
		</View>
	)
}

export default SongsScreen
