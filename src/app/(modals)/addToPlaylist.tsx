import { PlaylistsListModal } from '@/components/PlaylistsListModal'
import { screenPadding } from '@/constants/tokens'
import { unknownTrackImageUri } from '@/constants/images'
import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { useFavorites } from '@/store/library'
import { useDefaultStyles } from '@/styles'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'
import { showToast } from '@/utils/utils'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo } from 'react'
import { Alert, Pressable, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Track } from '@/player/types'
import { isSameMediaItem } from '@/utils/mediaItem'

const AddToPlaylistModal = () => {
	const defaultStyles = useDefaultStyles()
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(defaultStyles), [defaultStyles])
	const router = useRouter()
	const params = useLocalSearchParams()

	const track: IMusic.IMusicItem = {
		title: params.title as string,
		album: params.album as string,
		artwork: params.artwork as string,
		artist: params.artist as string,
		id: params.id as string,
		url: (params.url as string) || 'Unknown',
		platform: (params.platform as string) || 'tx',
		duration: typeof params.duration === 'string' ? parseInt(params.duration, 10) : 0,
	}
	const headerHeight = useHeaderHeight()

	const { favorites, toggleTrackFavorite } = useFavorites()
	// track was not found
	if (!track) {
		return null
	}

	const handlePlaylistPress = async (playlist: IMusic.PlayList) => {
		let result: 'success' | 'duplicate' | 'error' | 'not-found' = 'success'
		if (playlist.id === 'favorites') {
			if (favorites.some((item) => isSameMediaItem(item, track))) {
				result = 'duplicate'
			} else {
				toggleTrackFavorite(track as Track)
			}
		} else {
			result = myTrackPlayer.addSongToStoredPlayList(playlist, track)
		}
		if (result === 'duplicate') {
			showToast(i18n.t('addToPlaylist.duplicate'), playlist.title || playlist.name, 'info')
			return
		}
		if (result !== 'success') {
			showToast(i18n.t('addToPlaylist.addFailed'), undefined, 'error')
			return
		}
		router.dismiss()
		showToast(i18n.t('addToPlaylist.added'), playlist.title || playlist.name)
	}

	const createPlaylist = () => {
		Alert.prompt(
			i18n.t('addToPlaylist.createTitle'),
			i18n.t('addToPlaylist.createMessage'),
			(name) => {
				const title = name?.trim()
				if (!title) return
				const result = myTrackPlayer.addPlayLists({
					id: `playlist-${Date.now()}`,
					platform: 'local',
					artist: i18n.t('addToPlaylist.createdLocally'),
					name: title,
					title,
					artwork: track.artwork || unknownTrackImageUri,
					songs: [track],
				})
				if (result === 'success') {
					router.dismiss()
					showToast(i18n.t('addToPlaylist.createdAndAdded'), title)
				} else {
					showToast(i18n.t('addToPlaylist.addFailed'), undefined, 'error')
				}
			},
			'plain-text',
		)
	}

	return (
		<SafeAreaView style={[styles.modalContainer, { paddingTop: headerHeight }]}>
			<PlaylistsListModal
				onPlaylistPress={handlePlaylistPress}
				ListHeaderComponent={
					<Pressable
						accessibilityRole="button"
						onPress={createPlaylist}
						style={[styles.createButton, { backgroundColor: colors.surfaceElevated }]}
					>
						<Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>
							＋ {i18n.t('addToPlaylist.createTitle')}
						</Text>
					</Pressable>
				}
			/>
		</SafeAreaView>
	)
}

const createStyles = (defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		modalContainer: {
			...defaultStyles.container,
			paddingHorizontal: screenPadding.horizontal,
		},
		createButton: {
			borderRadius: 12,
			marginBottom: 14,
			paddingHorizontal: 16,
			paddingVertical: 14,
		},
	})

export default AddToPlaylistModal
