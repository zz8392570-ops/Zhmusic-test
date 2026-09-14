import { ThemeColors } from '@/constants/tokens'
import { Playlist } from '@/helpers/types'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import { AntDesign, Ionicons } from '@expo/vector-icons'
import { useMemo } from 'react'
import {
	StyleSheet,
	Text,
	TouchableHighlight,
	TouchableHighlightProps,
	TouchableOpacity,
	View,
} from 'react-native'
import { Image } from 'expo-image'
import { hapticLight, hapticWarning } from '@/utils/haptics'

type PlaylistListItemProps = {
	playlist: Playlist
	onDeletePress?: () => void
	onEditPress?: () => void
} & TouchableHighlightProps

export const PlaylistListItem = ({
	playlist,
	onDeletePress,
	onEditPress,
	onPress,
	onLongPress,
	...props
}: PlaylistListItemProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	const musicList = (playlist as Playlist & { musicList?: unknown[] }).musicList
	const songCount = playlist.tracks?.length ?? playlist.songs?.length ?? musicList?.length ?? 0

	return (
		<View style={styles.row}>
			<TouchableHighlight
				activeOpacity={0.8}
				underlayColor={colors.surfaceMuted}
				style={styles.mainAction}
				onPress={(event) => {
					hapticLight()
					onPress?.(event)
				}}
				onLongPress={
					onLongPress
						? (event) => {
								hapticWarning()
								onLongPress(event)
							}
						: undefined
				}
				accessibilityRole="button"
				accessibilityLabel={playlist.title || playlist.name}
				accessibilityHint={i18n.t('library.openPlaylist')}
				{...props}
			>
				<View style={styles.playlistItemContainer}>
					<Image
						contentFit="cover"
						cachePolicy="memory-disk"
						priority="normal"
						recyclingKey={
							(playlist.coverImg ? playlist.coverImg : playlist.artwork) ?? 'missing-artwork'
						}
						source={{ uri: playlist.coverImg || playlist.artwork }}
						style={styles.playlistArtworkImage}
					/>
					<View style={styles.playlistInfo}>
						<Text numberOfLines={1} style={styles.playlistNameText}>
							{playlist.title || playlist.name}
						</Text>
						<Text style={styles.playlistMetaText}>
							{i18n.t('library.songCount', { count: songCount })}
						</Text>
					</View>
					<AntDesign name="right" size={16} color={colors.icon} style={{ opacity: 0.5 }} />
				</View>
			</TouchableHighlight>
			{onEditPress ? (
				<TouchableOpacity
					accessibilityLabel={i18n.t('library.editTitle')}
					accessibilityRole="button"
					onPress={() => {
						hapticLight()
						onEditPress()
					}}
					style={styles.deleteAction}
				>
					<Ionicons name="pencil-outline" size={20} color={colors.textMuted} />
				</TouchableOpacity>
			) : null}
			{onDeletePress ? (
				<TouchableOpacity
					accessibilityLabel={i18n.t('library.deleteTitle')}
					accessibilityRole="button"
					onPress={() => {
						hapticWarning()
						onDeletePress()
					}}
					style={styles.deleteAction}
				>
					<Ionicons name="trash-outline" size={20} color={colors.textMuted} />
				</TouchableOpacity>
			) : null}
		</View>
	)
}

const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		row: {
			flexDirection: 'row',
			alignItems: 'center',
		},
		mainAction: {
			flex: 1,
			borderRadius: 10,
		},
		playlistItemContainer: {
			flexDirection: 'row',
			columnGap: 14,
			alignItems: 'center',
			paddingRight: 8,
		},
		playlistArtworkImage: {
			borderRadius: 8,
			width: 64,
			height: 64,
		},
		playlistInfo: {
			flex: 1,
			rowGap: 5,
		},
		playlistNameText: {
			...defaultStyles.text,
			fontSize: 17,
			fontWeight: '600',
		},
		playlistMetaText: {
			fontSize: 13,
			color: colors.textMuted,
		},
		deleteAction: {
			alignItems: 'center',
			justifyContent: 'center',
			width: 44,
			height: 44,
			marginLeft: 4,
		},
	})
