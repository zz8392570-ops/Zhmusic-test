import myTrackPlayer from '@/helpers/trackPlayerIndex'
import { getMusicPlatformLabelKey, supportsCatalogNavigation } from '@/helpers/musicPlatform'
import { getSingerMidBySingerName } from '@/helpers/userApi/getMusicSource'
import { useFavorites } from '@/store/library'
import { isInPlayList } from '@/store/playList'
import { useQueue } from '@/store/queue'
import i18n from '@/utils/i18n'
import type { MenuAction } from '@react-native-menu/menu'
import { MenuView } from '@/components/ActionMenu'
import { useFocusEffect, useRouter } from 'expo-router'
import { PropsWithChildren, useCallback, useMemo, useState } from 'react'
import type { Track } from '@/player/types'
import { match, P } from 'ts-pattern'
import { Alert } from 'react-native'
import { isSameMediaItem } from '@/utils/mediaItem'

type TrackShortcutsMenuProps = PropsWithChildren<{
	track: Track
	isSinger?: boolean
	allowDelete?: boolean
	onDeleteTrack?: (trackId: string) => void
}>

export const TrackShortcutsMenu = ({
	track,
	children,
	isSinger,
	allowDelete,
	onDeleteTrack,
}: TrackShortcutsMenuProps) => {
	const router = useRouter()
	const { favorites, toggleTrackFavorite } = useFavorites()
	const isFavorite = favorites.some((trackItem) =>
		isSameMediaItem(trackItem, track as IMusic.IMusicItem),
	)
	const { activeQueueId } = useQueue()

	const [isInPlaylist, setIsInPlaylist] = useState(false)
	const canNavigateCatalog = supportsCatalogNavigation(track.platform)
	const sourceOptions = useMemo(() => {
		const items = [track, ...(track.sourceAlternatives ?? [])]
		return items.filter(
			(item, index) =>
				items.findIndex(
					(candidate) => candidate.platform === item.platform && candidate.id === item.id,
				) === index,
		)
	}, [track])
	const sourceActions = useMemo<MenuAction[]>(
		() =>
			sourceOptions.length > 1
				? [
						{
							id: 'select-source',
							title: i18n.t('menu.selectSource'),
							image: 'antenna.radiowaves.left.and.right',
							subactions: sourceOptions.map((item, index) => {
								const labelKey = getMusicPlatformLabelKey(item.platform)
								return {
									id: `play-source-${index}`,
									title: labelKey ? i18n.t(labelKey) : String(item.platform ?? '').toUpperCase(),
									image: 'music.note',
								}
							}),
						},
					]
				: [],
		[sourceOptions],
	)

	const updateIsInPlaylist = useCallback(() => {
		setIsInPlaylist(isInPlayList(track as IMusic.IMusicItem))
	}, [track])

	useFocusEffect(
		useCallback(() => {
			updateIsInPlaylist()
		}, [updateIsInPlaylist]),
	)

	const handleViewArtist = (artist: string) => {
		getSingerMidBySingerName(artist).then((singerMid) => {
			router.push(`/(modals)/${singerMid}`)
		})
	}
	const handleAddToStoredPlayList = (track: IMusic.IMusicItem) => {
		router.push(
			`/(modals)/addToPlaylist?title=${track.title}&album=${track.album}&artwork=${track.artwork}&artist=${track.artist}&id=${track.id}&url=${track.url}&platform=${track.platform}&duration=${track.duration}`,
		)
	}
	const artists = useMemo(() => {
		if (typeof track.artist === 'string') {
			if (track.artist.includes('、')) {
				return track.artist.split('、').map((artist) => artist.trim())
			} else {
				return [track.artist]
			}
		} else if (Array.isArray(track.artist)) {
			return track.artist
		} else {
			return []
		}
	}, [track.artist])

	const artistActions = useMemo(() => {
		if (artists.length === 1) {
			return [
				{
					id: 'view-single-artist',
					title: i18n.t('menu.showArtist'),
					image: 'person',
				},
			]
		} else {
			return [
				{
					id: 'view-artists',
					title: i18n.t('menu.showArtist'),
					image: 'person',
					subactions: artists.map((artist) => ({
						id: `view-artist-${artist}`,
						title: artist,
						image: 'person',
					})),
				},
			]
		}
	}, [artists])

	const handlePressAction = async (id: string) => {
		await match(id)
			.with('add-to-favorites', async () => {
				toggleTrackFavorite(track)
				if (activeQueueId?.startsWith('favorites')) {
					//await TrackPlayer.add(track)
				}
			})
			.with('remove-from-favorites', async () => {
				toggleTrackFavorite(track)
				if (activeQueueId?.startsWith('favorites')) {
					// const queue = await TrackPlayer.getQueue()
					// const trackToRemove = queue.findIndex((queueTrack) => queueTrack.url === track.url)
					// await TrackPlayer.remove(trackToRemove)
				}
			})
			.with('add-to-playlist', async () => {
				await myTrackPlayer.add(track as IMusic.IMusicItem)
				updateIsInPlaylist()
			})
			.with('remove-from-playlist', async () => {
				await myTrackPlayer.remove(track as IMusic.IMusicItem)
				updateIsInPlaylist()
			})
			.with('view-single-artist', async () => {
				handleViewArtist(artists[0])
			})
			.with(
				P.when((id) => id.startsWith('view-artist-')),
				(id) => {
					const artist = id.replace('view-artist-', '')
					handleViewArtist(artist)
				},
			)
			.with('add-to-storedPlayList', async () => {
				handleAddToStoredPlayList(track as IMusic.IMusicItem)
			})
			.with('download', async () => {
				Alert.alert(i18n.t('player.download'), track.title, [
					{ text: i18n.t('find.cancel'), style: 'cancel' },
					{
						text: i18n.t('player.download'),
						onPress: () => void myTrackPlayer.cacheAndImportMusic(track as IMusic.IMusicItem),
					},
				])
			})
			.with('delete-track', async () => {
				onDeleteTrack?.(track.id)
			})
			.with(
				P.when((actionId) => actionId.startsWith('play-source-')),
				async (actionId) => {
					const index = Number(actionId.replace('play-source-', ''))
					const selectedSource = sourceOptions[index]
					if (selectedSource) await myTrackPlayer.play(selectedSource as IMusic.IMusicItem)
				},
			)
			.otherwise(() => {
				// handleViewArtist()
				console.warn(`Unknown menu action ${id}`)
			})
	}

	return (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => handlePressAction(event)}
			actions={[
				{
					id: isInPlaylist ? 'remove-from-playlist' : 'add-to-playlist',
					title: isInPlaylist
						? i18n.t('menu.removeFromPlayingList')
						: i18n.t('menu.addToPlayingList'),
					image: isInPlaylist ? 'minus' : 'plus',
				},
				{
					id: isFavorite ? 'remove-from-favorites' : 'add-to-favorites',
					title: isFavorite ? i18n.t('menu.removeFromFavorites') : i18n.t('menu.addToFavorites'),
					image: isFavorite ? 'heart.fill' : 'heart',
				},
				{
					id: 'add-to-storedPlayList',
					title: i18n.t('menu.addToPlaylist'),
					image: 'text.badge.plus',
				},
				...(track.platform !== 'local'
					? [{ id: 'download', title: i18n.t('player.download'), image: 'arrow.down.circle' }]
					: []),
				...sourceActions,
				...(isSinger || !canNavigateCatalog ? [] : (artistActions as MenuAction[])),
				...(allowDelete
					? [
							{
								id: 'delete-track',
								title: i18n.t('menu.delete'),
								image: 'trash',
								attributes: {
									destructive: true,
								},
							},
						]
					: []),
			]}
		>
			{children}
		</MenuView>
	)
}
