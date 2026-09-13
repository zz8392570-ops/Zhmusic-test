import * as Haptics from 'expo-haptics'

const safelyTrigger = (feedback: () => Promise<void>) => {
	try {
		void feedback().catch(() => {})
	} catch {
		// Haptics are optional feedback and must never block the action itself.
	}
}

export const hapticLight = () => {
	safelyTrigger(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))
}

export const hapticSelection = () => {
	safelyTrigger(() => Haptics.selectionAsync())
}

export const hapticSuccess = () => {
	safelyTrigger(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
}

export const hapticWarning = () => {
	safelyTrigger(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning))
}
