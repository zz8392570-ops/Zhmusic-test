import { RadioList } from '@/components/RadioList'
import { screenPadding } from '@/constants/tokens'
import { Playlist } from '@/helpers/types'
import { usePlaylists } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'
const RadiolistsScreen = () => {
	const defaultStyles = useDefaultStyles()
	const router = useRouter()
	const { playlists } = usePlaylists()

	const handlePlaylistPress = (playlist: Playlist) => {
		router.push(`/(tabs)/radio/${playlist.title}`)
	}

	return (
		<View style={defaultStyles.container}>
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
