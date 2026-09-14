import { RadioList } from '@/components/RadioList'
import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import {
	DEFAULT_HOME_SOURCE,
	fetchRadioPlaylists,
	normalizeLeaderboardSource,
} from '@/helpers/leaderboard'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'

const RadiolistsScreen = () => {
	const defaultStyles = useDefaultStyles()
	const colors = useThemeColors()
	const router = useRouter()
	const radioBoardSource = normalizeLeaderboardSource(
		PersistStatus.useValue('music.radioBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const [playlists, setPlaylists] = useState<Playlist[]>([])
	const [loading, setLoading] = useState(true)
	const [failed, setFailed] = useState(false)
	const requestRef = useRef(0)
	const cancelRequest = useCallback(() => {
		requestRef.current += 1
	}, [])

	const loadPlaylists = useCallback(
		async (clear = false) => {
			const requestId = ++requestRef.current
			setLoading(true)
			setFailed(false)
			if (clear) setPlaylists([])
			try {
				const list = await fetchRadioPlaylists(radioBoardSource)
				if (requestId !== requestRef.current) return
				setPlaylists(list)
				setFailed(list.length === 0)
			} catch (error) {
				console.error('Failed to fetch radio boards:', error)
				setFailed(true)
			} finally {
				if (requestId === requestRef.current) setLoading(false)
			}
		},
		[radioBoardSource],
	)

	useEffect(() => {
		void loadPlaylists(true)
		return cancelRequest
	}, [cancelRequest, loadPlaylists])

	const handlePlaylistPress = (playlist: Playlist) => {
		router.push({
			pathname: '/(tabs)/radio/[name]',
			params: { name: playlist.id },
		})
	}

	return (
		<View style={[defaultStyles.container, { backgroundColor: colors.background }]}>
			<SearchPlatformSelector
				includeAll={false}
				inset={screenPadding.horizontal}
				value={radioBoardSource}
				onChange={(platform) => {
					PersistStatus.set('music.radioBoardSource', platform as MusicPlatform)
				}}
			/>
			{loading && !playlists.length ? (
				<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<ActivityIndicator size="large" color={colors.loading} />
				</View>
			) : failed && !playlists.length ? (
				<View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
					<Text style={{ color: colors.textMuted, fontSize: 16 }}>{i18n.t('home.loadFailed')}</Text>
					<Pressable
						accessibilityRole="button"
						onPress={() => void loadPlaylists(true)}
						style={{ paddingHorizontal: 20, paddingVertical: 12 }}
					>
						<Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>
							{i18n.t('home.retry')}
						</Text>
					</Pressable>
				</View>
			) : (
				<ScrollView
					contentInsetAdjustmentBehavior="automatic"
					style={{
						paddingHorizontal: screenPadding.horizontal,
					}}
					refreshControl={
						<RefreshControl
							refreshing={loading}
							onRefresh={() => void loadPlaylists()}
							tintColor={colors.primary}
						/>
					}
				>
					<RadioList
						scrollEnabled={false}
						playlists={playlists}
						onPlaylistPress={handlePlaylistPress}
					/>
				</ScrollView>
			)}
		</View>
	)
}

export default RadiolistsScreen
