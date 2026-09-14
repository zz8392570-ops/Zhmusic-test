import LeaderboardCover from '@/components/LeaderboardCover'
import { ThemeColors } from '@/constants/tokens'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import { AntDesign } from '@expo/vector-icons'
import { useMemo } from 'react'
import { StyleSheet, Text, TouchableHighlight, TouchableHighlightProps, View } from 'react-native'

type PlaylistListItemProps = {
	playlist: Playlist
} & TouchableHighlightProps

export const RadioListItem = ({ playlist, ...props }: PlaylistListItemProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])

	return (
		<TouchableHighlight activeOpacity={0.8} underlayColor={colors.surfaceMuted} {...props}>
			<View style={styles.playlistItemContainer}>
				<LeaderboardCover
					boardId={playlist.id}
					platform={playlist.platform}
					title={playlist.title}
				/>

				<View
					style={{
						flexDirection: 'row',
						justifyContent: 'space-between',
						alignItems: 'center',
						width: '100%',
					}}
				>
					<Text numberOfLines={1} style={styles.playlistNameText}>
						{playlist.title}
					</Text>

					<AntDesign name="right" size={16} color={colors.icon} style={{ opacity: 0.5 }} />
				</View>
			</View>
		</TouchableHighlight>
	)
}

const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		playlistItemContainer: {
			flexDirection: 'row',
			columnGap: 14,
			alignItems: 'center',
			paddingRight: 90,
		},
		playlistNameText: {
			...defaultStyles.text,
			fontSize: 17,
			fontWeight: '600',
			maxWidth: '80%',
		},
	})
