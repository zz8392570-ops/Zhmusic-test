import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Switch,
	Text,
	View,
} from 'react-native'
import { Slider } from 'react-native-awesome-slider'
import { useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ThemeColors } from '@/constants/tokens'
import {
	SOUND_EFFECT_FREQUENCIES,
	SOUND_EFFECT_PRESETS,
	resetSoundEffects,
	selectSoundEffectPreset,
	soundEffectsStatusStore,
	soundEffectsStore,
	updateSoundEffects,
} from '@/helpers/soundEffects'
import { useThemeColors } from '@/hooks/useAppTheme'
import i18n from '@/utils/i18n'

const formatGain = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`
const formatFrequency = (value: number) => (value >= 1000 ? `${value / 1000} kHz` : `${value} Hz`)

const BandControl = ({
	frequency,
	value,
	disabled,
	resetDraftOnError,
	onChange,
}: {
	frequency: number
	value: number
	disabled: boolean
	resetDraftOnError: boolean
	onChange: (value: number) => void
}) => {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const [draft, setDraft] = useState(value)
	const progress = useSharedValue(value)
	const minimum = useSharedValue(-6)
	const maximum = useSharedValue(6)
	useEffect(() => {
		setDraft(value)
		progress.value = value
	}, [progress, resetDraftOnError, value])
	const commit = (next: number) => {
		const gain = Math.max(-6, Math.min(6, Math.round(next * 2) / 2))
		setDraft(gain)
		progress.value = gain
		onChange(gain)
	}
	return (
		<View style={[styles.band, disabled && styles.disabled]}>
			<View style={styles.row}>
				<Text style={styles.bandFrequency}>{formatFrequency(frequency)}</Text>
				<Text style={styles.gain}>{formatGain(draft)}</Text>
			</View>
			<View
				accessible
				accessibilityRole="adjustable"
				accessibilityLabel={i18n.t('soundEffects.adjustBand', {
					frequency: formatFrequency(frequency),
				})}
				accessibilityState={{ disabled }}
				accessibilityValue={{ min: -6, max: 6, now: draft, text: formatGain(draft) }}
				accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
				onAccessibilityAction={({ nativeEvent }) => {
					if (!disabled) commit(draft + (nativeEvent.actionName === 'increment' ? 0.5 : -0.5))
				}}
				style={styles.sliderArea}
			>
				<Slider
					progress={progress}
					minimumValue={minimum}
					maximumValue={maximum}
					disable={disabled}
					disableTapEvent={false}
					onValueChange={(gain) => setDraft(Math.round(gain * 2) / 2)}
					onSlidingComplete={commit}
					renderBubble={() => null}
					theme={{
						minimumTrackTintColor: colors.primary,
						maximumTrackTintColor: colors.border,
						bubbleBackgroundColor: colors.surfaceMuted,
					}}
				/>
			</View>
		</View>
	)
}

export default function SoundEffectsScreen() {
	const colors = useThemeColors()
	const styles = useMemo(() => createStyles(colors), [colors])
	const insets = useSafeAreaInsets()
	const settings = soundEffectsStore.useValue()
	const status = soundEffectsStatusStore.useValue()
	const [actionFailed, setActionFailed] = useState(false)
	const actionRevision = useRef(0)
	const apply = (action: () => Promise<void>) => {
		const revision = ++actionRevision.current
		setActionFailed(false)
		void action().catch(() => {
			if (revision === actionRevision.current) setActionFailed(true)
		})
	}
	const changeBand = (index: number, gain: number) => {
		const bands = [...soundEffectsStore.getValue().bands]
		bands[index] = gain
		apply(() => updateSoundEffects({ bands, preset: 'custom' }))
	}
	const reason = status.reason
	const reasonKey =
		status.state === 'error' && reason === 'processing'
			? 'soundEffects.processingFailed'
			: reason && ['platform', 'stream', 'format', 'unavailable', 'processing'].includes(reason)
				? `soundEffects.reasons.${reason}`
				: null
	return (
		<ScrollView
			style={styles.screen}
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}
		>
			<Text style={styles.intro}>{i18n.t('soundEffects.description')}</Text>
			<View style={styles.card}>
				<View style={styles.row}>
					<View style={styles.copy}>
						<Text style={styles.title}>{i18n.t('soundEffects.equalizer')}</Text>
						<Text style={styles.hint}>{i18n.t('soundEffects.equalizerHint')}</Text>
					</View>
					<Switch
						accessibilityLabel={i18n.t('soundEffects.equalizer')}
						value={settings.enabled}
						trackColor={{ false: colors.border, true: colors.primary }}
						onValueChange={(enabled) => apply(() => updateSoundEffects({ enabled }))}
					/>
				</View>
			</View>
			<View style={styles.status} accessibilityLiveRegion="polite">
				{status.state === 'waiting' ? (
					<ActivityIndicator size="small" color={colors.textMuted} />
				) : (
					<Ionicons
						name={status.state === 'active' ? 'checkmark-circle' : 'information-circle-outline'}
						size={18}
						color={status.state === 'active' ? colors.primary : colors.textMuted}
					/>
				)}
				<View style={styles.copy}>
					<Text style={styles.statusText}>{i18n.t(`soundEffects.status.${status.state}`)}</Text>
					{reasonKey && status.state !== 'active' ? (
						<Text style={styles.hint}>{i18n.t(reasonKey)}</Text>
					) : null}
					{actionFailed ? (
						<Text style={[styles.hint, { color: colors.error }]}>
							{i18n.t('soundEffects.updateFailed')}
						</Text>
					) : null}
				</View>
			</View>
			<Text style={styles.sectionTitle}>{i18n.t('soundEffects.presetsTitle')}</Text>
			<View style={styles.presets}>
				{SOUND_EFFECT_PRESETS.map(({ id }) => (
					<Pressable
						key={id}
						accessibilityRole="button"
						accessibilityState={{ selected: settings.preset === id }}
						onPress={() => apply(() => selectSoundEffectPreset(id))}
						style={({ pressed }) => [
							styles.preset,
							settings.preset === id && styles.selectedPreset,
							pressed && styles.pressed,
						]}
					>
						<Text style={[styles.presetText, settings.preset === id && styles.selectedPresetText]}>
							{i18n.t(`soundEffects.presets.${id}`)}
						</Text>
					</Pressable>
				))}
			</View>
			<View style={styles.sectionHeader}>
				<Text style={styles.sectionTitle}>{i18n.t('soundEffects.customTitle')}</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={i18n.t('soundEffects.resetBands')}
					onPress={() =>
						apply(() => updateSoundEffects({ preset: 'custom', bands: [0, 0, 0, 0, 0] }))
					}
					style={styles.textAction}
				>
					<Text style={styles.actionText}>{i18n.t('soundEffects.resetBands')}</Text>
				</Pressable>
			</View>
			<View style={styles.card}>
				{SOUND_EFFECT_FREQUENCIES.map((frequency, index) => (
					<BandControl
						key={frequency}
						frequency={frequency}
						value={settings.bands[index] ?? 0}
						disabled={!settings.enabled}
						resetDraftOnError={actionFailed}
						onChange={(gain) => changeBand(index, gain)}
					/>
				))}
				<Text style={styles.hint}>
					{i18n.t(settings.enabled ? 'soundEffects.bandHint' : 'soundEffects.enableHint')}
				</Text>
			</View>
			<View style={styles.card}>
				<View style={styles.row}>
					<View style={styles.copy}>
						<Text style={styles.title}>{i18n.t('soundEffects.volumeBalance')}</Text>
						<Text style={styles.hint}>{i18n.t('soundEffects.volumeBalanceHint')}</Text>
					</View>
					<Switch
						accessibilityLabel={i18n.t('soundEffects.volumeBalance')}
						value={settings.volumeBalance}
						trackColor={{ false: colors.border, true: colors.primary }}
						onValueChange={(volumeBalance) => apply(() => updateSoundEffects({ volumeBalance }))}
					/>
				</View>
			</View>
			<Text style={styles.footnote}>{i18n.t('soundEffects.soundCheckNote')}</Text>
			<Pressable
				accessibilityRole="button"
				onPress={() => apply(resetSoundEffects)}
				style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
			>
				<Text style={styles.actionText}>{i18n.t('soundEffects.resetAll')}</Text>
			</Pressable>
		</ScrollView>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		screen: { flex: 1, backgroundColor: colors.background },
		content: { paddingHorizontal: 18, paddingTop: 14, gap: 12 },
		intro: { color: colors.textMuted, fontSize: 14, lineHeight: 21, marginBottom: 2 },
		card: { backgroundColor: colors.surfaceMuted, borderRadius: 18, padding: 16 },
		row: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
		copy: { flex: 1, minWidth: 0 },
		title: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
		hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
		status: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 4 },
		statusText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
		sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '600', lineHeight: 22 },
		sectionHeader: {
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
			gap: 12,
			marginTop: 6,
		},
		presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
		preset: {
			flexGrow: 1,
			flexBasis: '28%',
			minHeight: 44,
			paddingHorizontal: 14,
			paddingVertical: 11,
			borderRadius: 14,
			backgroundColor: colors.surfaceMuted,
			alignItems: 'center',
			justifyContent: 'center',
		},
		selectedPreset: { backgroundColor: colors.primary },
		presetText: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500' },
		selectedPresetText: { color: '#fff' },
		band: { marginBottom: 6 },
		bandFrequency: { color: colors.text, fontSize: 14, lineHeight: 20 },
		gain: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
		sliderArea: { minHeight: 40, justifyContent: 'center', marginHorizontal: 4 },
		textAction: { minHeight: 44, justifyContent: 'center', paddingLeft: 8 },
		actionText: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
		footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingHorizontal: 4 },
		resetButton: {
			minHeight: 48,
			borderRadius: 16,
			backgroundColor: colors.surfaceMuted,
			alignItems: 'center',
			justifyContent: 'center',
			marginTop: 4,
		},
		pressed: { opacity: 0.6 },
		disabled: { opacity: 0.45 },
	})
