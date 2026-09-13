import { useThemeColors } from '@/hooks/useAppTheme'
import myTrackPlayer, {
	playbackIntentStore,
	trackSkipLoadingStore,
	trackSourceLoadingStore,
} from '@/helpers/trackPlayerIndex'
import { FontAwesome6 } from '@expo/vector-icons'
import React from 'react'
import { ActivityIndicator, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native'
import { PlaybackState, useIsPlaying, usePlaybackState } from '@rntp/player'
import i18n from '@/utils/i18n'
import { hapticLight } from '@/utils/haptics'

type PlayerControlsProps = {
	style?: ViewStyle
}

type PlayerButtonProps = {
	style?: ViewStyle
	iconSize?: number
	disabled?: boolean
}

export const PlayerControls = React.memo(({ style }: PlayerControlsProps) => {
	return (
		<View style={[styles.container, style]}>
			<View style={styles.row}>
				<SkipToPreviousButton />
				<PlayPauseButton />
				<SkipToNextButton />
			</View>
		</View>
	)
})

export const PlayPauseButton = React.memo(({ style, iconSize = 48 }: PlayerButtonProps) => {
	const playing = useIsPlaying()
	const state = usePlaybackState()
	const intent = playbackIntentStore.useValue()
	const sourcePending = trackSourceLoadingStore.useValue() !== null
	const shouldPause =
		playing || (intent === 'play' && (sourcePending || state === PlaybackState.Buffering))
	const colors = useThemeColors()
	const handlePress = () => {
		hapticLight()
		if (shouldPause) {
			void myTrackPlayer.pause()
		} else {
			void myTrackPlayer.play()
		}
	}

	return (
		<View style={[{ height: iconSize }, style]}>
			<TouchableOpacity
				activeOpacity={0.85}
				hitSlop={10}
				onPress={handlePress}
				accessibilityRole="button"
				accessibilityLabel={shouldPause ? i18n.t('player.pause') : i18n.t('playButton.play')}
				accessibilityState={{ busy: sourcePending || state === PlaybackState.Buffering }}
			>
				<FontAwesome6 name={shouldPause ? 'pause' : 'play'} size={iconSize} color={colors.text} />
			</TouchableOpacity>
		</View>
	)
})

export const SkipToNextButton = React.memo(
	({ iconSize = 30, disabled = false }: PlayerButtonProps) => {
		const colors = useThemeColors()
		const trackSkipLoading = trackSkipLoadingStore.useValue()
		const isLoading = trackSkipLoading === 'next'
		const isDisabled = disabled || trackSkipLoading !== null
		const handlePress = () => {
			hapticLight()
			void myTrackPlayer.skipToNext()
		}

		return (
			<TouchableOpacity
				activeOpacity={0.7}
				hitSlop={10}
				disabled={isDisabled}
				onPress={handlePress}
				accessibilityRole="button"
				accessibilityLabel={i18n.t('player.next')}
				accessibilityState={{ disabled: isDisabled, busy: isLoading }}
			>
				<View style={styles.iconContainer}>
					{isLoading ? (
						<ActivityIndicator size="small" color={colors.text} />
					) : (
						<FontAwesome6 name="forward" size={iconSize} color={colors.text} />
					)}
				</View>
			</TouchableOpacity>
		)
	},
)

export const SkipToPreviousButton = React.memo(({ iconSize = 30 }: PlayerButtonProps) => {
	const colors = useThemeColors()
	const trackSkipLoading = trackSkipLoadingStore.useValue()
	const isLoading = trackSkipLoading === 'previous'
	const isDisabled = trackSkipLoading !== null
	const handlePress = () => {
		hapticLight()
		void myTrackPlayer.skipToPrevious()
	}

	return (
		<TouchableOpacity
			activeOpacity={0.7}
			hitSlop={10}
			disabled={isDisabled}
			onPress={handlePress}
			accessibilityRole="button"
			accessibilityLabel={i18n.t('player.previous')}
			accessibilityState={{ disabled: isDisabled, busy: isLoading }}
		>
			<View style={styles.iconContainer}>
				{isLoading ? (
					<ActivityIndicator size="small" color={colors.text} />
				) : (
					<FontAwesome6 name={'backward'} size={iconSize} color={colors.text} />
				)}
			</View>
		</TouchableOpacity>
	)
})

const styles = StyleSheet.create({
	container: {
		width: '100%',
	},
	row: {
		flexDirection: 'row',
		justifyContent: 'space-evenly',
		alignItems: 'center',
	},
	iconContainer: {
		minWidth: 32,
		minHeight: 32,
		alignItems: 'center',
		justifyContent: 'center',
	},
})
