import i18n from '@/utils/i18n'
import { adaptLxMusicScript, isLxMusicScript } from './lxMusicSourceAdapter'

interface ModuleExports {
	id?: string
	author?: string
	name?: string
	version?: string
	srcUrl?: string
	getMusicUrl?: (
		songname: string,
		artist: string,
		songmid: string,
		quality: string,
	) => Promise<string>
}

export async function createMusicApiFromScript(rawScript: string): Promise<IMusic.MusicApi> {
	const script = rawScript?.trim?.() ?? ''
	if (!script) {
		throw new Error(i18n.t('sourceImport.scriptEmpty'))
	}

	if (isLxMusicScript(script)) {
		return adaptLxMusicScript(script)
	}

	const module: { exports: ModuleExports } = { exports: {} }
	const require = () => {}
	const moduleFunc = new Function('module', 'exports', 'require', script)
	moduleFunc(module, module.exports, require)

	if (typeof module.exports.getMusicUrl !== 'function') {
		throw new Error(i18n.t('sourceImport.missingGetter'))
	}

	return {
		id: module.exports.id || '',
		platform: 'tx',
		author: module.exports.author || '',
		name: module.exports.name || '',
		version: module.exports.version || '',
		srcUrl: module.exports.srcUrl || '',
		script,
		scriptType: 'zhmusic',
		isSelected: false,
		getMusicUrl: module.exports.getMusicUrl,
	}
}

export async function fetchScriptFromUrl(url: string): Promise<string> {
	const target = url?.trim?.()
	if (!target) {
		throw new Error(i18n.t('sourceImport.urlEmpty'))
	}
	const response = await fetch(target)
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`)
	}
	return response.text()
}

export function looksLikeScriptText(text?: string | null): boolean {
	if (!text) return false
	const normalized = text.trim()
	return /module\s*\.\s*exports\s*\.\s*getMusicUrl/.test(normalized) || isLxMusicScript(normalized)
}
