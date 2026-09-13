import GlobalButton from '@/components/GlobalButton'
import HomeHeaderTitle from '@/components/HomeHeaderTitle'
import { getStackScreenWithSearchBar } from '@/constants/layout'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import { nowLanguage } from '@/utils/i18n'
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
						headerLargeTitle: false,
						headerTitle: () => <HomeHeaderTitle />,
						headerRight: () => <GlobalButton />,
					}}
				/>
			</Stack>
		</View>
	)
}

export default SongsScreenLayout
