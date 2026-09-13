import { MaterialCommunityIcons } from '@expo/vector-icons'
import { router } from 'expo-router'
import React from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'

const GlobalButton = () => {
	const colors = useThemeColors()

	const showPlayList = () => {
		router.navigate('/(modals)/settingModal')
	}

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={i18n.t('settings.title')}
			hitSlop={8}
			onPress={showPlayList}
			style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
		>
			<MaterialCommunityIcons name="cog-outline" size={24} color={colors.icon} />
		</Pressable>
	)
}

const styles = StyleSheet.create({
	button: {
		width: 40,
		height: 40,
		alignItems: 'center',
		justifyContent: 'center',
	},
	buttonPressed: {
		opacity: 0.55,
	},
})

export default GlobalButton
