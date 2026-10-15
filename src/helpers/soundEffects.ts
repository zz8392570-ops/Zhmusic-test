import PersistStatus from '@/store/PersistStatus'
import { GlobalState } from '@/utils/stateMapper'
import nativeSoundEffects, {
	type NativeSoundEffectsStatus,
	type SoundEffectsStatus,
} from '../../modules/cymusic-native/soundEffects'

export const SOUND_EFFECT_FREQUENCIES = [60, 230, 910, 3600, 14000] as const
export const SOUND_EFFECT_PRESETS = [
	{ id: 'original', bands: [0, 0, 0, 0, 0] },
	{ id: 'balanced', bands: [1, 0, -0.5, 1, 0.5] },
	{ id: 'vocal', bands: [-2, -1, 1, 2, 1] },
	{ id: 'bass', bands: [4, 2, 0, -1, -1] },
	{ id: 'soft', bands: [1, 0, -1, -2, -3] },
	{ id: 'custom', bands: [0, 0, 0, 0, 0] },
] as const
export type SoundEffectPresetId = (typeof SOUND_EFFECT_PRESETS)[number]['id']
export type SoundEffectSettings = {
	enabled: boolean
	preset: SoundEffectPresetId
	bands: number[]
	volumeBalance: boolean
}

export const normalizeSoundEffects = (input: unknown): SoundEffectSettings => {
	const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
	const preset = SOUND_EFFECT_PRESETS.find((item) => item.id === value.preset)
	return {
		enabled: value.enabled === true,
		preset: preset?.id ?? 'original',
		bands: SOUND_EFFECT_FREQUENCIES.map((_, index) => {
			const gain = Array.isArray(value.bands) ? value.bands[index] : undefined
			return typeof gain === 'number' && Number.isFinite(gain)
				? Math.round(Math.max(-6, Math.min(6, gain)) * 10) / 10
				: preset?.bands[index] ?? 0
		}),
		volumeBalance: value.volumeBalance === true,
	}
}

let readError = false
const readSettings = () => {
	try {
		return normalizeSoundEffects(PersistStatus.get('music.soundEffects'))
	} catch {
		readError = true
		return normalizeSoundEffects(null)
	}
}
export const soundEffectsStore = new GlobalState<SoundEffectSettings>(readSettings())
export const soundEffectsStatusStore = new GlobalState<SoundEffectsStatus>(
	readError ? { state: 'error', reason: 'unavailable' } : { state: 'off' },
)
let revision = Date.now()
let applyTail: Promise<void> = Promise.resolve()
let subscription: { remove(): void } | undefined
let initialization: Promise<void> | undefined

const publish = (status: NativeSoundEffectsStatus) => {
	if (status.revision === revision)
		soundEffectsStatusStore.setValue({ state: status.state, reason: status.reason })
}
const applySettings = (): Promise<void> => {
	const requestedRevision = ++revision
	const settings = soundEffectsStore.getValue()
	const requested = settings.enabled || settings.volumeBalance
	soundEffectsStatusStore.setValue({ state: requested ? 'waiting' : 'off' })
	const operation = applyTail.then(async () => {
		if (requestedRevision !== revision) return
		if (!nativeSoundEffects) {
			soundEffectsStatusStore.setValue(
				requested ? { state: 'unsupported', reason: 'platform' } : { state: 'off' },
			)
			return
		}
		try {
			if (!subscription)
				subscription = nativeSoundEffects.addListener('soundEffectsChanged', publish)
			publish(await nativeSoundEffects.configure({ ...settings, revision: requestedRevision }))
		} catch (error) {
			if (requestedRevision === revision)
				soundEffectsStatusStore.setValue({ state: 'error', reason: 'processing' })
			throw error
		}
	})
	// Failure of one native application must not block the next retry.
	applyTail = operation.catch(() => {})
	return operation
}

export const initializeSoundEffects = (): Promise<void> => {
	if (!initialization) {
		initialization = applySettings().catch((error) => {
			initialization = undefined
			throw error
		})
	}
	return initialization
}

export const updateSoundEffects = (patch: Partial<SoundEffectSettings>): Promise<void> => {
	const settings = normalizeSoundEffects({ ...soundEffectsStore.getValue(), ...patch })
	try {
		PersistStatus.set('music.soundEffects', settings)
	} catch (error) {
		return Promise.reject(error)
	}
	soundEffectsStore.setValue(settings)
	return applySettings()
}

export const selectSoundEffectPreset = (id: SoundEffectPresetId): Promise<void> => {
	const preset = SOUND_EFFECT_PRESETS.find((item) => item.id === id)
	if (!preset) return Promise.reject(new Error('Unknown sound preset'))
	return updateSoundEffects({
		preset: id,
		enabled: id !== 'original',
		bands: id === 'custom' ? soundEffectsStore.getValue().bands : [...preset.bands],
	})
}

export const resetSoundEffects = () => updateSoundEffects(normalizeSoundEffects(null))
