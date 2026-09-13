import { useThemeColors } from '@/hooks/useAppTheme'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { router } from 'expo-router'
import React, { useCallback } from 'react'
import { ComponentProps } from 'react'
import i18n from '@/utils/i18n'
import { hapticSelection } from '@/utils/haptics'

type IconProps = Omit<ComponentProps<typeof MaterialCommunityIcons>, 'name'>

export const ShowPlayerListToggle = React.memo(({ ...iconProps }: IconProps) => {
	const colors = useThemeColors()

	const showPlayList = useCallback(() => {
		hapticSelection()
		router.navigate('/(modals)/playList')
	}, [])

	return (
		<MaterialCommunityIcons
			name={'playlist-music-outline'}
			onPress={showPlayList}
			color={colors.icon}
			hitSlop={10}
			accessibilityRole="button"
			accessibilityLabel={i18n.t('player.playingList')}
			{...iconProps}
		/>
	)
})
