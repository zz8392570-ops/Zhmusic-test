import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { unknownTrackImageUri } from '@/constants/images'
import { screenPadding } from '@/constants/tokens'
import {
	getBoardSongs,
	getLeaderboardBoardName,
	mapLeaderboardTrack,
	parseBoardKey,
} from '@/helpers/leaderboard'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { Redirect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import type { Track } from '@/player/types'

const RadioListScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const { name: playlistName } = useLocalSearchParams<{ name: string }>()
	const boardKey = Array.isArray(playlistName) ? playlistName[0] : playlistName
	const parsedBoard = useMemo(() => (boardKey ? parseBoardKey(boardKey) : null), [boardKey])
	const [tracks, setTracks] = useState<Track[]>([])
	const [loading, setLoading] = useState(true)
	const [failed, setFailed] = useState(false)

	const loadBoard = useCallback(async () => {
		if (!parsedBoard) {
			setLoading(false)
			setFailed(false)
			return
		}
		setLoading(true)
		setFailed(false)
		try {
			const detail = await getBoardSongs(parsedBoard.source, parsedBoard.bangid, 1)
			setTracks((detail.list ?? []).map((track) => mapLeaderboardTrack(track, parsedBoard.source)))
		} catch (error) {
			console.error('Failed to fetch leaderboard:', error)
			setTracks([])
			setFailed(true)
		} finally {
			setLoading(false)
		}
	}, [parsedBoard])

	useEffect(() => {
		loadBoard()
	}, [loadBoard])

	if (!parsedBoard) {
		return <Redirect href={'/(tabs)/radio'} />
	}

	if (loading) {
		return (
			<View
				style={{
					flex: 1,
					justifyContent: 'center',
					alignItems: 'center',
					backgroundColor: colors.background,
				}}
			>
				<ActivityIndicator size="large" color={colors.loading} />
			</View>
		)
	}

	if (failed) {
		return (
			<View
				style={[
					defaultStyles.container,
					{ justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
				]}
			>
				<Text style={{ color: colors.textMuted, fontSize: 16, marginBottom: 12 }}>
					{i18n.t('home.loadFailed')}
				</Text>
				<Pressable onPress={loadBoard}>
					<Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>
						{i18n.t('find.tapToRetry')}
					</Text>
				</Pressable>
			</View>
		)
	}

	const playlist = {
		id: boardKey,
		title: getLeaderboardBoardName(parsedBoard.source, parsedBoard.bangid),
		name: getLeaderboardBoardName(parsedBoard.source, parsedBoard.bangid),
		coverImg: tracks[0]?.artwork || unknownTrackImageUri,
		artwork: tracks[0]?.artwork || unknownTrackImageUri,
		artworkPreview: tracks[0]?.artwork || unknownTrackImageUri,
		singerImg: unknownTrackImageUri,
		period: '',
		description: '',
		platform: parsedBoard.source,
		artist: '',
		tracks,
		songs: [],
	}

	return (
		<View style={defaultStyles.container}>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<PlaylistTracksList playlist={playlist} tracks={tracks} />
			</ScrollView>
		</View>
	)
}

export default RadioListScreen
