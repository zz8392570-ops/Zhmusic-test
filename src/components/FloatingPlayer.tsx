import { searchSongByTitle } from '@/helpers/songSearchNavigation'
import { PlayPauseButton } from '@/components/PlayerControls'
import myTrackPlayer, { trackSourceLoadingStore } from '@/helpers/trackPlayerIndex'
import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors } from '@/constants/tokens'
import { useAppTheme, useThemeColors } from '@/hooks/useAppTheme'
import { useLastActiveTrack } from '@/hooks/useLastActiveTrack'
import { useDefaultStyles } from '@/styles'
import { BlurView } from 'expo-blur'
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
	ActivityIndicator,
	StyleSheet,
	Text,
	TouchableOpacity,
	View,
	ViewProps,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { MovingText } from './MovingText'
import i18n from '@/utils/i18n'
import { hapticLight } from '@/utils/haptics'

const ProgressIndicator = React.memo(() => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const { position, duration } = myTrackPlayer.useProgress(1)
	const progress = duration > 0 ? position / duration : 0
	return (
		<View style={styles.progressBarContainer}>
			<View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
		</View>
	)
})

export const FloatingPlayer = React.memo(({ style }: ViewProps) => {
	const { blurTint } = useAppTheme()
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors, defaultStyles), [colors, defaultStyles])
	const router = useRouter()
	const currentMusic = myTrackPlayer.useCurrentMusic()
	const lastActiveTrack = useLastActiveTrack()
	const isTrackSourceLoading = trackSourceLoadingStore.useValue() !== null
	const displayedTrack = currentMusic ?? lastActiveTrack

	const artworkOpacity = useSharedValue(1)
	const prevArtworkRef = useRef(displayedTrack?.artwork)

	useEffect(() => {
		if (displayedTrack?.artwork && displayedTrack.artwork !== prevArtworkRef.current) {
			artworkOpacity.value = 0
			artworkOpacity.value = withTiming(1, { duration: 400 })
			prevArtworkRef.current = displayedTrack.artwork
		}
	}, [artworkOpacity, displayedTrack?.artwork])

	const artworkAnimatedStyle = useAnimatedStyle(() => ({
		opacity: artworkOpacity.value,
	}))

	const handlePress = useCallback(() => {
		hapticLight()
		router.navigate('/player')
	}, [router])

	if (!displayedTrack) return null

	return (
		<View style={[styles.container, style]}>
			<BlurView intensity={80} tint={blurTint} style={styles.blurContainer}>
				<View style={styles.trackInfoAction}>
					<TouchableOpacity
						onPress={handlePress}
						activeOpacity={0.9}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('player.openNowPlaying')}
					>
						<Animated.View style={[styles.trackArtworkContainer, artworkAnimatedStyle]}>
							<Image
								contentFit="cover"
								cachePolicy="memory-disk"
								recyclingKey={displayedTrack.artwork ?? unknownTrackImageUri ?? 'missing-artwork'}
								source={{
									uri: displayedTrack.artwork ?? unknownTrackImageUri,
								}}
								style={StyleSheet.absoluteFill}
							/>
						</Animated.View>
					</TouchableOpacity>

					<TouchableOpacity
						style={styles.trackTitleContainer}
						onPress={() => searchSongByTitle(displayedTrack.title)}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('player.searchSong', { title: displayedTrack.title })}
					>
						<MovingText
							style={styles.trackTitle}
							text={displayedTrack.title ?? ''}
							animationThreshold={20}
						/>
						<Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
							{displayedTrack.artist}
						</Text>
					</TouchableOpacity>
				</View>

				<View style={styles.trackControlsContainer}>
					{isTrackSourceLoading ? (
						<View style={styles.loadingIndicatorContainer}>
							<ActivityIndicator size="small" color={colors.text} />
						</View>
					) : (
						<View style={styles.playButton}>
							<PlayPauseButton iconSize={20} />
						</View>
					)}
					<TouchableOpacity
						onPress={() => router.navigate('/(modals)/playList')}
						accessibilityRole="button"
						accessibilityLabel={i18n.t('queue.title')}
						style={{ padding: 6 }}
					>
						<Ionicons name="list-outline" size={25} color={colors.text} />
					</TouchableOpacity>
				</View>

				{!isTrackSourceLoading && <ProgressIndicator />}
			</BlurView>
		</View>
	)
})

const createStyles = (colors: ThemeColors, defaultStyles?: ReturnType<typeof useDefaultStyles>) =>
	StyleSheet.create({
		container: {
			borderRadius: 28,
			borderCurve: 'continuous',
			borderColor: colors.border,
			borderWidth: StyleSheet.hairlineWidth,
			overflow: 'hidden',
		},
		blurContainer: {
			flexDirection: 'row',
			alignItems: 'center',
			paddingHorizontal: 10,
			paddingVertical: 9,
		},
		trackInfoAction: {
			flex: 1,
			flexDirection: 'row',
			alignItems: 'center',
		},
		trackArtworkContainer: {
			width: 44,
			height: 44,
			borderRadius: 8,
			overflow: 'hidden',
		},
		trackTitleContainer: {
			flex: 1,
			overflow: 'hidden',
			marginLeft: 12,
		},
		trackTitle: {
			...(defaultStyles?.text ?? {}),
			fontSize: 15,
			fontWeight: '600',
		},
		playButton: {
			width: 38,
			height: 38,
			borderRadius: 19,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.overlaySoft,
			alignItems: 'center',
			justifyContent: 'center',
		},
		trackControlsContainer: {
			flexDirection: 'row',
			alignItems: 'center',
			columnGap: 8,
			marginRight: 0,
			paddingLeft: 12,
		},
		loadingIndicatorContainer: {
			minWidth: 24,
			minHeight: 24,
			alignItems: 'center',
			justifyContent: 'center',
		},
		progressBarContainer: {
			position: 'absolute',
			bottom: 6,
			left: 66,
			right: 110,
			height: 2,
			backgroundColor: colors.overlaySoft,
			borderRadius: 1,
		},
		progressBar: {
			height: '100%',
			backgroundColor: colors.primary,
			borderRadius: 1,
		},
	})
