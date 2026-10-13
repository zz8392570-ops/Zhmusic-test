import { getStackScreenWithSearchBar } from '@/constants/layout'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import { nowLanguage } from '@/utils/i18n'
import i18n from '@/utils/i18n'
import { Stack } from 'expo-router'
import { View } from 'react-native'
const SongsScreenLayout = () => {
	const language = nowLanguage.useValue()
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	return (
		<View style={defaultStyles.container} key={language}>
			<Stack>
				<Stack.Screen
					name="index"
					options={{
						...getStackScreenWithSearchBar(colors),
						headerShown: false,
						headerLargeTitle: false,
						headerTitle: i18n.t('appTab.songs'),
					}}
				/>
			</Stack>
		</View>
	)
}

export default SongsScreenLayout
