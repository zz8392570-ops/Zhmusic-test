import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { screenPadding } from '@/constants/tokens'
import myTrackPlayer, { playListsStore } from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { searchSongsAcrossPlatforms } from '@/helpers/crossPlatformSearch'
import {
	findDuplicateTrackIds,
	rankReplacementSources,
	rankReplacementSourcesWithScore,
	sortPlaylistTracks,
	type PlaylistSortField,
} from '@/helpers/playlistOrganizer'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import { getImportedPlaylistSource, refreshImportedPlaylist } from '@/helpers/importPlaylist'
import { useDefaultStyles } from '@/styles'
import { Redirect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import type { Track } from '@/player/types'
import type { MenuAction } from '@react-native-menu/menu'
import i18n from '@/utils/i18n'
import { resolveSource } from '@/player/MusicSourceResolver'
import { fakeAudioMp3Uri } from '@/constants/images'

const PlaylistScreen = () => {
	const defaultStyles = useDefaultStyles()
	const { name: playlistID } = useLocalSearchParams<{ name: string }>()
	const playlists = playListsStore.useValue() as Playlist[] | null
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
	const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [isRepairing, setIsRepairing] = useState(false)

	const playlist = useMemo(() => {
		return playlists?.find((p) => p.id === playlistID)
	}, [playlistID, playlists])

	const songs = useMemo(() => {
		return playlist?.songs || []
	}, [playlist])

	const handleDeleteTrack = useCallback(
		(trackId: string) => {
			myTrackPlayer.deleteSongFromStoredPlayList(playlist as Playlist, trackId)
		},
		[playlist],
	)

	const saveSongs = useCallback(
		(nextSongs: IMusic.IMusicItem[]) => {
			const result = myTrackPlayer.replaceStoredPlaylistSongs(playlistID, nextSongs)
			if (result !== 'success') Alert.alert(i18n.t('playlistTools.updateFailed'))
			return result
		},
		[playlistID],
	)

	const toggleMultiSelectMode = useCallback(() => {
		setIsMultiSelectMode((enabled) => {
			if (enabled) setSelectedTracks(new Set())
			return !enabled
		})
	}, [])

	const onToggleSelection = useCallback((trackId: string) => {
		setSelectedTracks((current) => {
			const next = new Set(current)
			if (next.has(trackId)) next.delete(trackId)
			else next.add(trackId)
			return next
		})
	}, [])

	const onSelectAll = useCallback(() => {
		setSelectedTracks((current) =>
			current.size === songs.length ? new Set() : new Set(songs.map((song) => song.id)),
		)
	}, [songs])

	const deleteSelectedTracks = useCallback(() => {
		if (!selectedTracks.size) return
		Alert.alert(
			i18n.t('playlistTools.deleteSelectedTitle'),
			i18n.t('playlistTools.deleteSelectedMessage', { count: selectedTracks.size }),
			[
				{ text: i18n.t('find.cancel'), style: 'cancel' },
				{
					text: i18n.t('playlistTools.delete'),
					style: 'destructive',
					onPress: () => {
						if (saveSongs(songs.filter((song) => !selectedTracks.has(song.id))) === 'success') {
							setSelectedTracks(new Set())
							setIsMultiSelectMode(false)
						}
					},
				},
			],
		)
	}, [saveSongs, selectedTracks, songs])

	const importedSource = useMemo(
		() => (playlist ? getImportedPlaylistSource(playlist) : null),
		[playlist],
	)

	const refreshOnlinePlaylist = useCallback(async () => {
		if (!playlist || !importedSource || isRefreshing) return
		setIsRefreshing(true)
		try {
			const refreshed = await refreshImportedPlaylist(playlist)
			const result = myTrackPlayer.updateStoredPlaylist(playlistID, {
				songs: refreshed.songs,
				sourcePlaylistId: refreshed.sourcePlaylistId,
				sourceSnapshotKeys: refreshed.sourceSnapshotKeys,
				sourceLastRefreshedAt: refreshed.sourceLastRefreshedAt,
				sourceOverrides: refreshed.sourceOverrides,
			})
			if (result !== 'success') throw new Error(result)
			Alert.alert(
				i18n.t('playlistTools.refreshComplete'),
				i18n.t('playlistTools.refreshSummary', {
					added: refreshed.added,
					removed: refreshed.removed,
					preserved: refreshed.preserved,
				}),
			)
		} catch {
			Alert.alert(i18n.t('playlistTools.refreshFailed'))
		} finally {
			setIsRefreshing(false)
		}
	}, [importedSource, isRefreshing, playlist, playlistID])

	const managementActions = useMemo<MenuAction[]>(
		() => [
			...(importedSource
				? [
						{
							id: 'refresh',
							title: i18n.t(
								isRefreshing ? 'playlistTools.refreshing' : 'playlistTools.refreshOnline',
							),
							image: 'arrow.clockwise',
							attributes: { disabled: isRefreshing },
						},
					]
				: []),
			{
				id: 'sort',
				title: i18n.t('playlistTools.sort'),
				image: 'arrow.up.arrow.down',
				subactions: (['title', 'artist', 'album', 'duration', 'source'] as PlaylistSortField[]).map(
					(field) => ({ id: `sort-${field}`, title: i18n.t(`playlistTools.sortFields.${field}`) }),
				),
			},
			{
				id: 'duplicates',
				title: i18n.t('playlistTools.findDuplicates'),
				image: 'square.on.square',
			},
			{
				id: 'repair',
				title: i18n.t(isRepairing ? 'playlistTools.repairing' : 'playlistTools.repairUnavailable'),
				image: 'wrench.and.screwdriver',
				attributes: { disabled: isRepairing },
			},
			{ id: 'select', title: i18n.t('playlistTools.selectSongs'), image: 'checkmark.circle' },
		],
		[importedSource, isRefreshing, isRepairing],
	)

	const repairUnavailableSongs = useCallback(async () => {
		if (isRepairing || !songs.length) return
		setIsRepairing(true)
		let unavailable = 0
		let repaired = 0
		let needsReview = 0
		const nextSongs = [...songs]
		const sourcePlaylist = playlist as (Playlist & IMusic.PlayList) | undefined
		const sourceOverrides = { ...(sourcePlaylist?.sourceOverrides ?? {}) } as Record<string, string>
		const snapshotKeys = new Set(
			Array.isArray(sourcePlaylist?.sourceSnapshotKeys) ? sourcePlaylist.sourceSnapshotKeys : [],
		)
		try {
			for (let index = 0; index < songs.length; index++) {
				const track = songs[index] as Track
				const resolved = await resolveSource(track as IMusic.IMusicItem, {
					requestType: 'download',
					totalTimeoutMs: 8_000,
				})
				if (resolved.url !== fakeAudioMp3Uri && !resolved.url.includes('fake')) continue
				unavailable++
				const query = [track.title, track.artist].filter(Boolean).join(' ')
				const search = await searchSongsAcrossPlatforms(query, 1, 'all')
				const best = rankReplacementSourcesWithScore(track, search.data)[0]
				if (!best || best.score < 14) {
					needsReview++
					continue
				}
				const replacement = await resolveSource(best.track as IMusic.IMusicItem, {
					requestType: 'download',
					totalTimeoutMs: 8_000,
				})
				if (replacement.url === fakeAudioMp3Uri || replacement.url.includes('fake')) {
					needsReview++
					continue
				}
				nextSongs[index] = best.track as IMusic.IMusicItem
				const originalKey = `${track.platform}@${track.id}`
				const replacementKey = `${best.track.platform}@${best.track.id}`
				const sourceKey = snapshotKeys.has(originalKey)
					? originalKey
					: Object.entries(sourceOverrides).find(([, value]) => value === originalKey)?.[0]
				if (sourceKey) sourceOverrides[sourceKey] = replacementKey
				repaired++
			}
			if (
				repaired &&
				myTrackPlayer.updateStoredPlaylist(playlistID, { songs: nextSongs, sourceOverrides }) !==
					'success'
			)
				throw new Error('save failed')
			Alert.alert(
				i18n.t('playlistTools.repairComplete'),
				i18n.t('playlistTools.repairSummary', { unavailable, repaired, review: needsReview }),
			)
		} catch {
			Alert.alert(i18n.t('playlistTools.repairFailed'))
		} finally {
			setIsRepairing(false)
		}
	}, [isRepairing, playlist, playlistID, songs])

	const onManagementAction = useCallback(
		(actionId: string) => {
			if (actionId === 'repair') {
				void repairUnavailableSongs()
				return
			}
			if (actionId === 'refresh') {
				void refreshOnlinePlaylist()
				return
			}
			if (actionId.startsWith('sort-')) {
				const field = actionId.replace('sort-', '') as PlaylistSortField
				if (
					saveSongs(sortPlaylistTracks(songs as Track[], field) as IMusic.IMusicItem[]) ===
					'success'
				) {
					Alert.alert(i18n.t('playlistTools.sorted'))
				}
				return
			}
			if (actionId === 'select') {
				setSelectedTracks(new Set())
				setIsMultiSelectMode(true)
				return
			}
			if (actionId === 'duplicates') {
				const duplicates = findDuplicateTrackIds(songs as Track[])
				if (!duplicates.size) {
					Alert.alert(i18n.t('playlistTools.noDuplicates'))
					return
				}
				setSelectedTracks(duplicates)
				setIsMultiSelectMode(true)
				Alert.alert(
					i18n.t('playlistTools.duplicatesFoundTitle'),
					i18n.t('playlistTools.duplicatesFoundMessage', { count: duplicates.size }),
				)
			}
		},
		[refreshOnlinePlaylist, repairUnavailableSongs, saveSongs, songs],
	)

	const replaceSource = useCallback(
		async (track: Track) => {
			try {
				const query = [track.title, track.artist].filter(Boolean).join(' ')
				const result = await searchSongsAcrossPlatforms(query, 1, 'all')
				const candidates = rankReplacementSources(track, result.data).slice(0, 5)
				if (!candidates.length) {
					Alert.alert(i18n.t('playlistTools.noReplacement'))
					return
				}
				Alert.alert(
					i18n.t('playlistTools.chooseSource'),
					i18n.t('playlistTools.chooseSourceMessage', { name: track.title }),
					[
						...candidates.map((candidate) => {
							const labelKey = getMusicPlatformLabelKey(candidate.platform)
							const platform = labelKey
								? i18n.t(labelKey)
								: String(candidate.platform ?? '').toUpperCase()
							return {
								text: `${platform} · ${candidate.title} — ${candidate.artist}`,
								onPress: () => {
									const replaceResult = myTrackPlayer.replaceSongInStoredPlayList(
										playlistID,
										track as IMusic.IMusicItem,
										candidate as IMusic.IMusicItem,
									)
									Alert.alert(
										replaceResult === 'success'
											? i18n.t('playlistTools.replaced')
											: i18n.t(
													replaceResult === 'duplicate'
														? 'playlistTools.replacementDuplicate'
														: 'playlistTools.updateFailed',
												),
									)
								},
							}
						}),
						{ text: i18n.t('find.cancel'), style: 'cancel' },
					],
				)
			} catch {
				Alert.alert(i18n.t('playlistTools.sourceSearchFailed'))
			}
		},
		[playlistID],
	)

	if (!playlist) {
		console.warn(`Playlist ${playlistID} was not found!`)
		return <Redirect href={'/(tabs)/favorites'} />
	}

	return (
		<View style={defaultStyles.container}>
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<PlaylistTracksList
					playlist={playlist as Playlist}
					tracks={songs as Track[]}
					allowDelete={true}
					onDeleteTrack={handleDeleteTrack}
					isMultiSelectMode={isMultiSelectMode}
					selectedTracks={selectedTracks}
					toggleMultiSelectMode={toggleMultiSelectMode}
					onToggleSelection={onToggleSelection}
					onSelectAll={onSelectAll}
					deleteSelectedTracks={deleteSelectedTracks}
					managementActions={managementActions}
					onManagementAction={onManagementAction}
					onReplaceSource={replaceSource}
				/>
			</ScrollView>
		</View>
	)
}

export default PlaylistScreen
