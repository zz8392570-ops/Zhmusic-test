import { TrackShortcutsMenu } from '@/components/TrackShortcutsMenu'
import AudioQualityBadge from '@/components/AudioQualityBadge'
import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors } from '@/constants/tokens'
import { getCachedQuality } from '@/player/CacheManager'
import { cacheRevisionStore } from '@/player/PlayerStore'
import { isCachedIconVisibleStore } from '@/helpers/trackPlayerIndex'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import { getThumbnailArtwork } from '@/utils/imageUtils'
import { Entypo, Ionicons } from '@expo/vector-icons'
import React, { memo, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableHighlight, TouchableOpacity, View } from 'react-native'
import { Image } from 'expo-image'
import LoaderKit from 'react-native-loader-kit'
import type { Track } from '@/player/types'
import {
	inferAudioQualityFromPath,
	normalizeAudioQuality,
	type AudioQuality,
} from '@/helpers/audioQuality'
import i18n from '@/utils/i18n'
import { getMusicPlatformLabelKey } from '@/helpers/musicPlatform'
import { hapticLight, hapticSelection } from '@/utils/haptics'

export type TracksListItemProps = {
	track: Track
	onTrackSelect: (track: Track) => void
	isActiveTrack?: boolean
	isPlaying?: boolean
	isSinger?: boolean
	allowDelete?: boolean
	onDeleteTrack?: (trackId: string) => void
	isMultiSelectMode?: boolean
	onToggleSelection?: (trackId: string) => void
	selectedTracks?: Set<string>
	toggleMultiSelectMode?: () => void
	showSourceBadge?: boolean
}

const TracksListItem = ({
	track,
	onTrackSelect: handleTrackSelect,
	isActiveTrack = false,
	isPlaying = false,
	isSinger = false,
	allowDelete = false,
	isMultiSelectMode = false,
	onToggleSelection,
	selectedTracks,
	onDeleteTrack,
	toggleMultiSelectMode,
	showSourceBadge = false,
}: TracksListItemProps) => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	const isCachedIconVisible = isCachedIconVisibleStore.useValue()
	const cacheRevision = cacheRevisionStore.useValue()
	const embeddedCachedQuality = useMemo(
		() =>
			normalizeAudioQuality(track.cachedQuality) ??
			(typeof track.url === 'string' && track.url.includes('/musicCache/')
				? inferAudioQualityFromPath(track.url)
				: null),
		[track.cachedQuality, track.url],
	)
	const [cachedQuality, setCachedQuality] = useState<AudioQuality | null>(embeddedCachedQuality)
	const cacheLookupTrack = useMemo(
		() =>
			({
				id: track.id,
				platform: track.platform,
				title: track.title,
				artist: track.artist,
				duration: track.duration ?? 0,
				album: track.album ?? '',
				artwork: track.artwork ?? '',
				url: track.url,
				cachedQuality: track.cachedQuality,
			}) as IMusic.IMusicItem,
		[
			track.album,
			track.artist,
			track.artwork,
			track.cachedQuality,
			track.duration,
			track.id,
			track.platform,
			track.title,
			track.url,
		],
	)
	const artworkSource = useMemo(
		() => ({
			uri: getThumbnailArtwork(track.artwork) ?? unknownTrackImageUri,
		}),
		[track.artwork],
	)

	useEffect(() => {
		let isMounted = true
		setCachedQuality(embeddedCachedQuality)
		const checkCachedState = async () => {
			try {
				const quality = await getCachedQuality(cacheLookupTrack)
				if (isMounted) {
					setCachedQuality(quality)
				}
			} catch {
				if (isMounted) {
					setCachedQuality(null)
				}
			}
		}

		checkCachedState()

		return () => {
			isMounted = false
		}
	}, [cacheLookupTrack, cacheRevision, embeddedCachedQuality])

	const isCachedTrack = cachedQuality !== null
	const platformLabelKey = getMusicPlatformLabelKey(track.platform)
	const platformLabel = platformLabelKey
		? i18n.t(platformLabelKey)
		: String(track.platform ?? '').toUpperCase()
	const sourceCount = new Set(track.availablePlatforms ?? [track.platform]).size
	const sourceBadgeLabel = sourceCount > 1 ? `${platformLabel} +${sourceCount - 1}` : platformLabel
	const selected = selectedTracks?.has(track.id) === true
	const handlePress = () => {
		if (isMultiSelectMode) {
			hapticSelection()
			onToggleSelection?.(track.id)
			return
		}
		hapticLight()
		handleTrackSelect(track)
	}
	const handleLongPress = () => {
		if (!toggleMultiSelectMode) return
		hapticSelection()
		toggleMultiSelectMode()
	}

	return (
		<View style={styles.rowContainer}>
			<TouchableHighlight
				onPress={handlePress}
				onLongPress={handleLongPress}
				underlayColor={colors.surfaceMuted}
				style={styles.mainAction}
				accessibilityRole="button"
				accessibilityLabel={[track.title, track.artist].filter(Boolean).join(', ')}
				accessibilityHint={
					isMultiSelectMode ? i18n.t('tracks.selectHint') : i18n.t('tracks.playHint')
				}
				accessibilityState={{ selected: isMultiSelectMode ? selected : undefined }}
			>
				<View style={styles.trackItemContainer}>
					{isMultiSelectMode && (
						<View style={styles.selectionIndicator}>
							<Ionicons
								name={selected ? 'checkbox' : 'square-outline'}
								size={24}
								color={selected ? colors.primary : colors.textMuted}
							/>
						</View>
					)}
					<View>
						<Image
							contentFit="cover"
							cachePolicy="memory-disk"
							priority="normal"
							recyclingKey={artworkSource.uri ?? 'missing-artwork'}
							source={artworkSource}
							style={{
								...styles.trackArtworkImage,
								opacity: isActiveTrack ? 0.6 : 1,
							}}
						/>

						{isActiveTrack &&
							(isPlaying ? (
								<LoaderKit
									style={styles.trackPlayingIconIndicator}
									name="LineScaleParty"
									color={colors.icon}
								/>
							) : (
								<Ionicons
									style={styles.trackPausedIndicator}
									name="play"
									size={24}
									color={colors.icon}
								/>
							))}
					</View>
					<View style={styles.trackInfo}>
						<View style={styles.trackTitleRow}>
							{isCachedTrack && isCachedIconVisible && (
								<Ionicons
									name="cloud-done-outline"
									size={13}
									color={isActiveTrack ? colors.primary : colors.textMuted}
									style={styles.cachedIcon}
								/>
							)}
							<Text
								numberOfLines={1}
								style={{
									...styles.trackTitleText,
									color: isActiveTrack ? colors.primary : colors.text,
								}}
							>
								{track.title}
							</Text>
						</View>
						{track.artist || showSourceBadge || cachedQuality ? (
							<View style={styles.trackMetadataRow}>
								{track.artist ? (
									<Text numberOfLines={1} style={styles.trackArtistText}>
										{track.artist}
									</Text>
								) : null}
								<View style={styles.badgesRow}>
									{showSourceBadge && sourceBadgeLabel ? (
										<View style={styles.sourceBadge}>
											<Text style={styles.sourceBadgeText}>{sourceBadgeLabel}</Text>
										</View>
									) : null}
									<AudioQualityBadge quality={cachedQuality} compact />
								</View>
							</View>
						) : null}
					</View>
				</View>
			</TouchableHighlight>
			{!isMultiSelectMode ? (
				<TrackShortcutsMenu
					track={track}
					isSinger={isSinger}
					allowDelete={allowDelete}
					onDeleteTrack={onDeleteTrack}
				>
					<TouchableOpacity
						style={styles.shortcutsButton}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('player.songOptions')}
					>
						<Entypo name="dots-three-horizontal" size={18} color={colors.icon} />
					</TouchableOpacity>
				</TrackShortcutsMenu>
			) : null}
		</View>
	)
}
export default memo(TracksListItem)
const createStyles = (colors: ThemeColors, defaultStyles: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		rowContainer: {
			flexDirection: 'row',
			alignItems: 'center',
		},
		mainAction: {
			flex: 1,
			borderRadius: 8,
		},
		trackItemContainer: {
			flexDirection: 'row',
			columnGap: 14,
			alignItems: 'center',
			paddingRight: 8,
		},
		selectionIndicator: {
			marginRight: 10,
		},
		trackInfo: {
			flex: 1,
		},
		shortcutsButton: {
			width: 44,
			height: 44,
			alignItems: 'center',
			justifyContent: 'center',
		},
		trackPlayingIconIndicator: {
			position: 'absolute',
			top: 18,
			left: 16,
			width: 16,
			height: 16,
		},
		trackPausedIndicator: {
			position: 'absolute',
			top: 14,
			left: 14,
		},
		trackArtworkImage: {
			borderRadius: 8,
			width: 50,
			height: 50,
		},
		trackTitleRow: {
			flexDirection: 'row',
			alignItems: 'center',
		},
		cachedIcon: {
			marginRight: 4,
		},
		trackTitleText: {
			...defaultStyles.text,
			fontSize: 17,
			fontWeight: '400',
			flexShrink: 1,
			maxWidth: '100%',
		},
		trackArtistText: {
			...defaultStyles.text,
			color: colors.textMuted,
			fontSize: 14,
			flex: 1,
		},
		trackMetadataRow: {
			minHeight: 21,
			flexDirection: 'row',
			alignItems: 'center',
			gap: 7,
			marginTop: 3,
		},
		badgesRow: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 5,
		},
		sourceBadge: {
			minHeight: 18,
			justifyContent: 'center',
			paddingHorizontal: 6,
			borderRadius: 5,
			backgroundColor: colors.surfaceMuted,
		},
		sourceBadgeText: {
			color: colors.textMuted,
			fontSize: 10,
			fontWeight: '600',
		},
	})
