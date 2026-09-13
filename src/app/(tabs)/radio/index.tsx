import { RadioList } from '@/components/RadioList'
import SearchPlatformSelector from '@/components/search/SearchPlatformSelector'
import { screenPadding } from '@/constants/tokens'
import type { MusicPlatform } from '@/helpers/crossPlatformSearch'
import {
	DEFAULT_HOME_SOURCE,
	boardsToPlaylists,
	normalizeLeaderboardSource,
} from '@/helpers/leaderboard'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import PersistStatus from '@/store/PersistStatus'
import { useDefaultStyles } from '@/styles'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { ScrollView, View } from 'react-native'

const RadiolistsScreen = () => {
	const defaultStyles = useDefaultStyles()
	const colors = useThemeColors()
	const router = useRouter()
	const radioBoardSource = normalizeLeaderboardSource(
		PersistStatus.useValue('music.radioBoardSource', DEFAULT_HOME_SOURCE) ?? DEFAULT_HOME_SOURCE,
	)
	const playlists = useMemo(() => boardsToPlaylists(radioBoardSource), [radioBoardSource])

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
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{
					paddingHorizontal: screenPadding.horizontal,
				}}
			>
				<RadioList
					scrollEnabled={false}
					playlists={playlists}
					onPlaylistPress={handlePlaylistPress}
				/>
			</ScrollView>
		</View>
	)
}

export default RadiolistsScreen
