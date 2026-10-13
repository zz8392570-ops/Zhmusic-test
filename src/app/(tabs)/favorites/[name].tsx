import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import myTrackPlayer, { playListsStore } from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { searchSongsAcrossPlatforms } from '@/helpers/crossPlatformSearch'
import {
	findDuplicateTrackKeys,
	rankReplacementSources,
	sortPlaylistTracks,
	type PlaylistSortField,
	type PlaylistSortDirection,
} from '@/helpers/playlistOrganizer'
import { serializePlaylistFile } from '@/helpers/playlistFile'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import {
	fetchImportedPlaylistSongs,
	getImportedPlaylistSource,
	mergeConcurrentImportedPlaylistRefresh,
} from '@/helpers/importPlaylist'
import { copyLibraryTracks, getLibraryTrackKey, mergePlaylistRepairs } from '@/helpers/libraryEdits'
import { useDefaultStyles } from '@/styles'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { File, Paths } from 'expo-file-system'
import React, { useCallback, useMemo, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import type { Track } from '@/player/types'
import type { MenuAction } from '@react-native-menu/menu'
import i18n from '@/utils/i18n'
import { repairUnavailableTracks } from '@/helpers/libraryRepair'
import { shareLocalFiles } from '../../../../modules/cymusic-native/sharing'
import shuffle from 'lodash.shuffle'

const PlaylistScreen = () => {
	const defaultStyles = useDefaultStyles()
	const { name: playlistID } = useLocalSearchParams<{ name: string }>()
	const playlists = playListsStore.useValue() as Playlist[] | null
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
	const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [isRepairing, setIsRepairing] = useState(false)
	const [isExporting, setIsExporting] = useState(false)

	const playlist = useMemo(() => {
		return playlists?.find((p) => p.id === playlistID)
	}, [playlistID, playlists])

	const songs = useMemo(() => {
		return playlist?.songs || []
	}, [playlist])

	const handleDeleteTrack = useCallback(
		(track: Track) => {
			myTrackPlayer.deleteSongFromStoredPlayList(playlist as Playlist, track)
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
			songs.every((song) => current.has(getLibraryTrackKey(song)))
				? new Set()
				: new Set(songs.map(getLibraryTrackKey)),
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
						const result = myTrackPlayer.updateStoredPlaylist(playlistID, (current) => ({
							songs: current.songs.filter((song) => !selectedTracks.has(getLibraryTrackKey(song))),
						}))
						if (result === 'success') {
							setSelectedTracks(new Set())
							setIsMultiSelectMode(false)
						} else {
							Alert.alert(i18n.t('playlistTools.updateFailed'))
						}
					},
				},
			],
		)
	}, [playlistID, selectedTracks])

	const organizeSelectedTracks = useCallback(
		(action: 'add' | 'move' | 'top' | 'bottom') => {
			const selected = songs.filter((song) => selectedTracks.has(getLibraryTrackKey(song)))
			if (!selected.length) return
			if (action === 'top' || action === 'bottom') {
				const result = myTrackPlayer.updateStoredPlaylist(playlistID, (current) => {
					const latestSelected = current.songs.filter((song) =>
						selectedTracks.has(getLibraryTrackKey(song)),
					)
					const rest = current.songs.filter((song) => !selectedTracks.has(getLibraryTrackKey(song)))
					return {
						songs: action === 'top' ? [...latestSelected, ...rest] : [...rest, ...latestSelected],
					}
				})
				if (result === 'success') {
					setSelectedTracks(new Set())
					setIsMultiSelectMode(false)
					Alert.alert(i18n.t('playlistTools.positionUpdated'))
				}
				return
			}
			const destinations = (playlists ?? []).filter((item) => item.id !== playlistID)
			if (!destinations.length) {
				Alert.alert(i18n.t('playlistTools.noDestination'))
				return
			}
			Alert.alert(
				i18n.t(action === 'move' ? 'playlistTools.moveSelected' : 'playlistTools.addSelected'),
				i18n.t('playlistTools.chooseDestination'),
				[
					...destinations.map((destination) => ({
						text: destination.title || destination.name,
						onPress: () => {
							const latestSelected =
								(playListsStore.getValue() ?? [])
									.find((item) => item.id === playlistID)
									?.songs.filter((song) => selectedTracks.has(getLibraryTrackKey(song))) ?? []
							const result =
								action === 'move'
									? myTrackPlayer.moveSongsBetweenStoredPlaylists(
											playlistID,
											destination.id,
											latestSelected,
										)
									: myTrackPlayer.addSongsToStoredPlayList(destination.id, latestSelected)
							if (result.status === 'success') {
								Alert.alert(
									i18n.t('playlistTools.organizeComplete'),
									i18n.t('playlistTools.organizeSummary', {
										count: 'moved' in result ? result.moved : result.added,
									}),
								)
								if (action === 'move') {
									setSelectedTracks(new Set())
									setIsMultiSelectMode(false)
								}
							} else {
								Alert.alert(i18n.t('playlistTools.organizeFailed'))
							}
						},
					})),
					{ text: i18n.t('find.cancel'), style: 'cancel' },
				],
			)
		},
		[playlistID, playlists, selectedTracks, songs],
	)

	const exportPlaylist = useCallback(async () => {
		if (!playlist || isExporting) return
		setIsExporting(true)
		const safeName = (playlist.title || playlist.name || 'playlist')
			.replace(/[\\/:*?"<>|]+/g, '_')
			.slice(0, 80)
		const file = new File(Paths.cache, `lx_list_part_${safeName}.lxmc`)
		try {
			file.create({ overwrite: true })
			file.write(serializePlaylistFile(playlist as IMusic.PlayList))
			await shareLocalFiles([file.uri])
		} catch {
			Alert.alert(i18n.t('playlistTools.exportFailed'))
		} finally {
			try {
				if (file.exists) file.delete()
			} catch {
				/* Temporary export cleanup is best effort. */
			}
			setIsExporting(false)
		}
	}, [isExporting, playlist])

	const clearPlaylist = useCallback(() => {
		if (!songs.length) return
		Alert.alert(i18n.t('playlistTools.clearTitle'), i18n.t('playlistTools.clearMessage'), [
			{ text: i18n.t('find.cancel'), style: 'cancel' },
			{
				text: i18n.t('playlistTools.clear'),
				style: 'destructive',
				onPress: () => void saveSongs([]),
			},
		])
	}, [saveSongs, songs.length])

	const importedSource = useMemo(
		() => (playlist ? getImportedPlaylistSource(playlist) : null),
		[playlist],
	)

	const refreshOnlinePlaylist = useCallback(async () => {
		if (!playlist || !importedSource || isRefreshing) return
		setIsRefreshing(true)
		try {
			const latest = (playListsStore.getValue() ?? []).find((item) => item.id === playlistID)
			if (!latest) throw new Error('playlist removed')
			const baseline = JSON.parse(JSON.stringify(latest)) as IMusic.PlayList
			const remote = await fetchImportedPlaylistSongs(baseline)
			const summary = { added: 0, removed: 0, preserved: 0 }
			const result = myTrackPlayer.updateStoredPlaylist(playlistID, (current) => {
				const source = getImportedPlaylistSource(current)
				if (
					!source ||
					source.source !== baseline.platform ||
					source.id !== remote.sourcePlaylistId ||
					(current.sourceLastRefreshedAt ?? 0) !== (baseline.sourceLastRefreshedAt ?? 0)
				)
					return null
				const refreshed = mergeConcurrentImportedPlaylistRefresh(
					baseline,
					current,
					remote.songs,
					remote.sourcePlaylistId,
				)
				Object.assign(summary, {
					added: refreshed.added,
					removed: refreshed.removed,
					preserved: refreshed.preserved,
				})
				return {
					songs: refreshed.songs,
					sourcePlaylistId: refreshed.sourcePlaylistId,
					sourceSnapshotKeys: refreshed.sourceSnapshotKeys,
					sourceLastRefreshedAt: refreshed.sourceLastRefreshedAt,
					sourceOverrides: refreshed.sourceOverrides,
				}
			})
			if (result !== 'success') throw new Error(result)
			Alert.alert(
				i18n.t('playlistTools.refreshComplete'),
				i18n.t('playlistTools.refreshSummary', summary),
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
				subactions: [
					...(['title', 'artist', 'album', 'duration', 'source'] as PlaylistSortField[]).flatMap(
						(field) =>
							(['asc', 'desc'] as PlaylistSortDirection[]).map((direction) => ({
								id: `sort-${field}-${direction}`,
								title: `${i18n.t(`playlistTools.sortFields.${field}`)} · ${i18n.t(`playlistTools.sortDirections.${direction}`)}`,
							})),
					),
					{ id: 'sort-random', title: i18n.t('playlistTools.sortDirections.random') },
				],
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
			{
				id: 'export',
				title: i18n.t(isExporting ? 'playlistTools.exporting' : 'playlistTools.export'),
				image: 'square.and.arrow.up',
				attributes: { disabled: isExporting },
			},
			{
				id: 'clear',
				title: i18n.t('playlistTools.clear'),
				image: 'trash',
				attributes: { destructive: true },
			},
		],
		[importedSource, isExporting, isRefreshing, isRepairing],
	)

	const repairUnavailableSongs = useCallback(async () => {
		if (isRepairing || !songs.length) return
		setIsRepairing(true)
		try {
			const latest = (playListsStore.getValue() ?? []).find((item) => item.id === playlistID)
			if (!latest) throw new Error('playlist removed')
			const baseline = copyLibraryTracks(latest.songs)
			const result = await repairUnavailableTracks(copyLibraryTracks(baseline))
			let repaired = 0
			if (result.repaired) {
				const status = myTrackPlayer.updateStoredPlaylist(playlistID, (current) => {
					const merged = mergePlaylistRepairs(current, baseline, result.replacements)
					repaired = merged.repaired
					return { songs: merged.songs, sourceOverrides: merged.sourceOverrides }
				})
				if (status !== 'success') throw new Error(status)
			}
			Alert.alert(
				i18n.t('playlistTools.repairComplete'),
				i18n.t('playlistTools.repairSummary', {
					unavailable: result.unavailable,
					repaired,
					review: result.review.length,
				}),
			)
		} catch {
			Alert.alert(i18n.t('playlistTools.repairFailed'))
		} finally {
			setIsRepairing(false)
		}
	}, [isRepairing, playlistID, songs])

	const onManagementAction = useCallback(
		(actionId: string) => {
			if (actionId === 'export') {
				void exportPlaylist()
				return
			}
			if (actionId === 'clear') {
				clearPlaylist()
				return
			}
			if (actionId === 'repair') {
				void repairUnavailableSongs()
				return
			}
			if (actionId === 'refresh') {
				void refreshOnlinePlaylist()
				return
			}
			if (actionId === 'sort-random') {
				if (saveSongs(shuffle(songs)) === 'success') Alert.alert(i18n.t('playlistTools.sorted'))
				return
			}
			if (actionId.startsWith('sort-')) {
				const [, field, direction] = actionId.split('-') as [
					string,
					PlaylistSortField,
					PlaylistSortDirection,
				]
				if (
					saveSongs(
						sortPlaylistTracks(songs as Track[], field, direction) as IMusic.IMusicItem[],
					) === 'success'
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
				const duplicates = findDuplicateTrackKeys(songs as Track[])
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
		[
			clearPlaylist,
			exportPlaylist,
			refreshOnlinePlaylist,
			repairUnavailableSongs,
			saveSongs,
			songs,
		],
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
				contentContainerStyle={{ paddingHorizontal: 18 }}
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
					onSelectedAction={organizeSelectedTracks}
					onReplaceSource={replaceSource}
				/>
			</ScrollView>
		</View>
	)
}

export default PlaylistScreen
