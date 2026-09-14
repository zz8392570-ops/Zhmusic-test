import i18n from '@/utils/i18n'
import { router } from 'expo-router'
import { Alert, AppState } from 'react-native'

export type AutomaticSourceSwitchReason =
	| 'timeout'
	| 'noPlayableUrl'
	| 'requestFailed'
	| 'network'
	| 'source'
	| 'renderer'
	| 'healthCheckFailed'
	| 'unknown'

type SourceSwitchNotice = {
	fromSource: string
	toSource: string
	reason: AutomaticSourceSwitchReason
	songTitle?: string | null
}

type SourceExhaustedNotice = {
	songTitle: string
	triedCount: number
	willSkip: boolean
}

const reasonKeys: Record<AutomaticSourceSwitchReason, string> = {
	timeout: 'player.sourceSwitch.reasons.timeout',
	noPlayableUrl: 'player.sourceSwitch.reasons.noPlayableUrl',
	requestFailed: 'player.sourceSwitch.reasons.requestFailed',
	network: 'player.sourceSwitch.reasons.network',
	source: 'player.sourceSwitch.reasons.source',
	renderer: 'player.sourceSwitch.reasons.renderer',
	healthCheckFailed: 'player.sourceSwitch.reasons.healthCheckFailed',
	unknown: 'player.sourceSwitch.reasons.unknown',
}

export const getPlaybackSourceSwitchReason = (
	code?: string | null,
	message?: string | null,
): AutomaticSourceSwitchReason => {
	if (code === 'network' || /timeout|timed out|network|connection|超时|网络/i.test(message ?? '')) {
		return code === 'network' ? 'network' : 'timeout'
	}
	if (code === 'source') return 'source'
	if (code === 'renderer') return 'renderer'
	return 'unknown'
}

export const showAutomaticSourceSwitchNotice = ({
	fromSource,
	toSource,
	reason,
	songTitle,
}: SourceSwitchNotice) => {
	if (AppState.currentState !== 'active') return

	const reasonText = i18n.t(reasonKeys[reason])
	const message = songTitle?.trim()
		? i18n.t('player.sourceSwitch.songMessage', {
				song: songTitle.trim(),
				from: fromSource,
				to: toSource,
				reason: reasonText,
			})
		: i18n.t('player.sourceSwitch.generalMessage', {
				from: fromSource,
				to: toSource,
				reason: reasonText,
			})

	Alert.alert(i18n.t('player.sourceSwitch.title'), message, [
		{ text: i18n.t('player.sourceSwitch.confirm') },
	])
}

export const showSourceExhaustedNotice = ({
	songTitle,
	triedCount,
	willSkip,
}: SourceExhaustedNotice): Promise<'retry' | 'next' | 'stop'> => {
	if (AppState.currentState !== 'active') return Promise.resolve(willSkip ? 'next' : 'stop')

	return new Promise((resolve) => {
		Alert.alert(
			i18n.t('player.sourceSwitch.allFailedTitle'),
			i18n.t('player.sourceSwitch.allFailedMessage', { song: songTitle, count: triedCount }),
			[
				{
					text: i18n.t('player.sourceSwitch.stop'),
					style: 'cancel',
					onPress: () => resolve('stop'),
				},
				{
					text: i18n.t('player.sourceSwitch.sourceSettings'),
					onPress: () => {
						resolve('stop')
						router.push('/(modals)/settingModal')
					},
				},
				{ text: i18n.t('player.sourceSwitch.retrySong'), onPress: () => resolve('retry') },
				...(willSkip
					? [
							{
								text: i18n.t('player.sourceSwitch.nextSong'),
								onPress: () => resolve('next') as void,
							},
						]
					: []),
			],
			{ cancelable: false },
		)
	})
}
