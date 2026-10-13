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
import { MenuView } from '@/components/ActionMenu'

type PlaylistListItemProps = {
	playlist: Playlist
	onDeletePress?: () => void
	onEditPress?: () => void
	presentation?: 'default' | 'library'
} & TouchableHighlightProps

export const PlaylistListItem = ({
	playlist,
	onDeletePress,
	onEditPress,
	onPress,
	onLongPress,
	presentation = 'default',
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
					<View>
						<Image
							contentFit="cover"
							cachePolicy="memory-disk"
							priority="normal"
							recyclingKey={
								(playlist.coverImg ? playlist.coverImg : playlist.artwork) ?? 'missing-artwork'
							}
							source={{ uri: playlist.coverImg || playlist.artwork }}
							style={[
								styles.playlistArtworkImage,
								presentation === 'library' && { width: 88, height: 88, borderRadius: 12 },
							]}
						/>
						{presentation === 'library' && playlist.pinned ? (
							<View
								style={{
									position: 'absolute',
									top: 5,
									left: 5,
									flexDirection: 'row',
									alignItems: 'center',
									gap: 3,
									backgroundColor: colors.primary,
									borderRadius: 9,
									paddingHorizontal: 6,
									paddingVertical: 3,
								}}
							>
								<Ionicons name="pin" size={10} color="#fff" />
								<Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
									{i18n.t('library.pinned')}
								</Text>
							</View>
						) : null}
					</View>
					<View style={styles.playlistInfo}>
						<View style={styles.titleRow}>
							{playlist.pinned && presentation !== 'library' ? (
								<Ionicons name="pin" size={14} color={colors.primary} />
							) : null}
							<Text
								numberOfLines={1}
								style={[
									styles.playlistNameText,
									presentation === 'library' && { fontSize: 19, fontWeight: '700' },
								]}
							>
								{playlist.title || playlist.name}
							</Text>
						</View>
						<Text style={styles.playlistMetaText}>
							{[playlist.folder, i18n.t('library.songCount', { count: songCount })]
								.filter(Boolean)
								.join(' · ')}
						</Text>
					</View>
					{presentation !== 'library' ? (
						<AntDesign name="right" size={16} color={colors.icon} style={{ opacity: 0.5 }} />
					) : null}
				</View>
			</TouchableHighlight>
			{presentation === 'library' && (onEditPress || onDeletePress) ? (
				<MenuView
					title={playlist.title || playlist.name}
					actions={[
						...(onEditPress ? [{ id: 'edit', title: i18n.t('library.editTitle') }] : []),
						...(onDeletePress
							? [
									{
										id: 'delete',
										title: i18n.t('library.delete'),
										attributes: { destructive: true },
									},
								]
							: []),
					]}
					onPressAction={({ nativeEvent: { event } }) =>
						event === 'edit' ? onEditPress?.() : onDeletePress?.()
					}
				>
					<TouchableOpacity
						style={styles.deleteAction}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('library.editTitle')}
					>
						<Ionicons name="ellipsis-vertical" size={23} color={colors.textMuted} />
					</TouchableOpacity>
				</MenuView>
			) : null}
			{presentation !== 'library' && onEditPress ? (
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
			{presentation !== 'library' && onDeletePress ? (
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
			flex: 1,
			fontSize: 17,
			fontWeight: '600',
		},
		titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
