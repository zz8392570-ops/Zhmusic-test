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
import { getFavoriteVariants, getFavoriteIndex } from '@/helpers/favoriteGroups'
import { preferFavoriteSource, splitFavoriteGroup } from '@/helpers/favoriteGroupActions'
import { getDownloadQuality, getDownloadQualityActions } from '@/helpers/downloadQuality'
import { getDislikeArtists } from '@/helpers/dislikeRules'

type TrackShortcutsMenuProps = PropsWithChildren<{
	track: Track
	isSinger?: boolean
	allowDelete?: boolean
	onDeleteTrack?: (track: Track) => void
	onReplaceSource?: (track: Track) => void
}>

export const TrackShortcutsMenu = ({
	track,
	children,
	isSinger,
	allowDelete,
	onDeleteTrack,
	onReplaceSource,
}: TrackShortcutsMenuProps) => {
	const router = useRouter()
	const { favorites, toggleTrackFavorite } = useFavorites()
	const favoriteIndex = getFavoriteIndex(favorites)
	const isFavorite = favoriteIndex.has(track)
	const { activeQueueId } = useQueue()

	const [isInPlaylist, setIsInPlaylist] = useState(false)
	const canNavigateCatalog = supportsCatalogNavigation(track.platform)
	const dislikeArtists = getDislikeArtists(track)
	const sourceOptions = useMemo(() => {
		const stored = favoriteIndex.find(track)
		const items = stored ? getFavoriteVariants(stored) : getFavoriteVariants(track)
		return items.filter(
			(item, index) =>
				items.findIndex(
					(candidate) => candidate.platform === item.platform && candidate.id === item.id,
				) === index,
		)
	}, [favoriteIndex, track])
	const sourceActions = useMemo<MenuAction[]>(
		() =>
			sourceOptions.length > 1
				? [
						{
							id: 'select-source',
							title: i18n.t(isFavorite ? 'menu.preferSource' : 'menu.selectSource'),
							image: 'antenna.radiowaves.left.and.right',
							subactions: sourceOptions.map((item, index) => {
								const labelKey = getMusicPlatformLabelKey(item.platform)
								return {
									id: `play-source-${index}`,
									title: labelKey ? i18n.t(labelKey) : String(item.platform ?? '').toUpperCase(),
									image: 'music.note',
									state: isFavorite && index === 0 ? 'on' : 'off',
								}
							}),
						},
					]
				: [],
		[sourceOptions, isFavorite],
	)

	const updateIsInPlaylist = useCallback(() => {
		setIsInPlaylist(isInPlayList((track.playbackQueueOrigin ?? track) as IMusic.IMusicItem))
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
		router.push({
			pathname: '/(modals)/addToPlaylist',
			params: {
				title: track.title ?? '',
				album: track.album ?? '',
				artwork: track.artwork ?? '',
				artist: track.artist ?? '',
				id: track.id,
				originalId: track.originalId ?? '',
				url: track.url || 'Unknown',
				platform: track.platform ?? 'tx',
				duration: track.duration ?? 0,
				favoriteKeepSeparate: track.favoriteKeepSeparate ? 'true' : 'false',
			},
		})
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
			.with('play-later', async () => {
				try {
					await myTrackPlayer.addToPlayLater(track)
				} catch {
					Alert.alert(i18n.t('playLater.failed'))
				}
			})
			.with('dislike-song', () => {
				try {
					myTrackPlayer.dislikeSong(track)
				} catch {
					Alert.alert(i18n.t('dislikes.failed'))
				}
			})
			.with(
				P.when((actionId) => actionId.startsWith('dislike-artist-')),
				(actionId) => {
					const artist = dislikeArtists[Number(actionId.replace('dislike-artist-', ''))]
					try {
						if (artist) myTrackPlayer.dislikeArtist(artist)
					} catch {
						Alert.alert(i18n.t('dislikes.failed'))
					}
				},
			)
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
			.with(
				P.when((actionId) => !!getDownloadQuality(actionId)),
				async (actionId) => {
					await myTrackPlayer
						.cacheAndImportMusic(track as IMusic.IMusicItem, {
							quality: getDownloadQuality(actionId),
							strictQuality: true,
						})
						.catch(() => Alert.alert(i18n.t('cacheCenter.downloadFailed')))
				},
			)
			.with('split-favorite', () => {
				try {
					splitFavoriteGroup(track)
				} catch {
					Alert.alert(i18n.t('favoriteGroups.failed'))
				}
			})
			.with('manage-platforms', () =>
				router.push({
					pathname: '/(modals)/favoriteVersions',
					params: { id: track.id, platform: track.platform },
				}),
			)
			.with('replace-source', async () => {
				onReplaceSource?.(track)
			})
			.with('delete-track', async () => {
				onDeleteTrack?.(track)
			})
			.with(
				P.when((actionId) => actionId.startsWith('play-source-')),
				async (actionId) => {
					const index = Number(actionId.replace('play-source-', ''))
					const selectedSource = sourceOptions[index]
					if (selectedSource) {
						try {
							const preferred = preferFavoriteSource(track, selectedSource)
							await myTrackPlayer.play((preferred ?? selectedSource) as IMusic.IMusicItem)
						} catch {
							Alert.alert(i18n.t('favoriteGroups.failed'))
						}
					}
				},
			)
			.otherwise(() => {
				// handleViewArtist()
				console.warn(`Unknown menu action ${id}`)
			})
	}

	const allActions: MenuAction[] = [
		{ id: 'play-later', title: i18n.t('playLater.add'), image: 'text.badge.plus' },
		...(dislikeArtists.length
			? [
					{
						id: 'dislike',
						title: i18n.t('dislikes.menu'),
						image: 'hand.thumbsdown',
						subactions: [
							...(track.title
								? [{ id: 'dislike-song', title: i18n.t('dislikes.song'), image: 'music.note' }]
								: []),
							...dislikeArtists.map((artist, index) => ({
								id: `dislike-artist-${index}`,
								title: i18n.t('dislikes.artist', { artist }),
								image: 'person',
							})),
						],
					},
				]
			: []),
		{
			id: isInPlaylist ? 'remove-from-playlist' : 'add-to-playlist',
			title: isInPlaylist ? i18n.t('menu.removeFromPlayingList') : i18n.t('menu.addToPlayingList'),
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
			? [
					{
						id: 'download',
						title: i18n.t('player.download'),
						image: 'arrow.down.circle',
						subactions: getDownloadQualityActions(),
					},
				]
			: []),
		...(onReplaceSource && track.platform !== 'local'
			? [
					{
						id: 'replace-source',
						title: i18n.t('playlistTools.replaceSource'),
						image: 'arrow.triangle.2.circlepath',
					},
				]
			: []),
		...sourceActions,
		...(isFavorite && sourceOptions.length > 1
			? [
					{
						id: 'manage-platforms',
						title: i18n.t('versions.title'),
						image: 'slider.horizontal.3',
					},
				]
			: []),
		...(isFavorite && sourceOptions.length > 1
			? [
					{
						id: 'split-favorite',
						title: i18n.t('favoriteGroups.split'),
						image: 'arrow.triangle.branch',
					},
				]
			: []),
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
	]
	const secondaryIds = new Set([
		'dislike',
		'replace-source',
		'manage-platforms',
		'split-favorite',
		'add-to-playlist',
		'remove-from-playlist',
	])
	const secondary = allActions.filter((action) => secondaryIds.has(action.id))
	const actions = [
		...allActions.filter((action) => !secondaryIds.has(action.id) && action.id !== 'delete-track'),
		...(secondary.length
			? [{ id: 'more', title: i18n.t('menu.moreActions'), subactions: secondary }]
			: []),
		...allActions.filter((action) => action.id === 'delete-track'),
	]
	return (
		<MenuView
			onPressAction={({ nativeEvent: { event } }) => handlePressAction(event)}
			actions={actions}
		>
			{children}
		</MenuView>
	)
}
