import { useThemeColors } from '@/hooks/useAppTheme'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import React, { useCallback } from 'react'
import { ComponentProps } from 'react'
import { match } from 'ts-pattern'
import myTrackPlayer, { MusicRepeatMode, repeatModeStore } from '@/helpers/trackPlayerIndex'
import i18n from '@/utils/i18n'
import { hapticSelection } from '@/utils/haptics'

type IconProps = Omit<ComponentProps<typeof MaterialCommunityIcons>, 'name'>
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']

export const PlayerRepeatToggle = React.memo(({ ...iconProps }: IconProps) => {
	const repeatMode = repeatModeStore.useValue()
	const colors = useThemeColors()

	const toggleRepeatMode = useCallback(() => {
		hapticSelection()
		myTrackPlayer.toggleRepeatMode()
	}, [])

	const icon = match(repeatMode)
		.returnType<IconName>()
		.with(MusicRepeatMode.SHUFFLE, () => 'shuffle')
		.with(MusicRepeatMode.SINGLE, () => 'repeat-once')
		.with(MusicRepeatMode.QUEUE, () => 'repeat')
		.otherwise(() => 'repeat-off')
	const modeLabel = match(repeatMode)
		.with(MusicRepeatMode.SHUFFLE, () => i18n.t('player.repeatMode.shuffle'))
		.with(MusicRepeatMode.SINGLE, () => i18n.t('player.repeatMode.single'))
		.with(MusicRepeatMode.QUEUE, () => i18n.t('player.repeatMode.queue'))
		.otherwise(() => i18n.t('player.repeatMode.off'))

	return (
		<MaterialCommunityIcons
			name={icon}
			onPress={toggleRepeatMode}
			color={colors.icon}
			hitSlop={10}
			accessibilityRole="button"
			accessibilityLabel={i18n.t('player.repeatMode.title')}
			accessibilityValue={{ text: modeLabel }}
			{...iconProps}
		/>
	)
})
