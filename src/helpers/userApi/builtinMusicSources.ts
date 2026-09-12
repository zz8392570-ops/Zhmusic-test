import { Asset } from 'expo-asset'
import * as FileSystem from 'expo-file-system/legacy'
import dujia from '@/assets/music-sources/dujia-v5.sourcejs'
import hyw from '@/assets/music-sources/hyw-beta.sourcejs'
import kxh from '@/assets/music-sources/kxh.sourcejs'
import molanV200 from '@/assets/music-sources/molan-v200.sourcejs'
import molanV230 from '@/assets/music-sources/molan-v230.sourcejs'
import xinghai from '@/assets/music-sources/xinghai.sourcejs'
import yuningxi from '@/assets/music-sources/yuningxi.sourcejs'
import yuxi from '@/assets/music-sources/yuxi-final.sourcejs'
import { parseLxMusicScriptInfo } from './lxMusicSourceAdapter'

export const BUNDLED_SOURCES_VERSION = 1

type BundledSourceDef = {
	key: string
	asset: number
	displayName?: string
}

const BUNDLED_SOURCE_DEFS: BundledSourceDef[] = [
	{ key: 'dujia_v5', asset: dujia },
	{ key: 'yuxi_final', asset: yuxi },
	{ key: 'molan_v230', asset: molanV230, displayName: '墨澜聚合音源 2.3.0' },
	{ key: 'molan_v200', asset: molanV200, displayName: '墨澜聚合音源 2.0.0' },
	{ key: 'xinghai', asset: xinghai },
	{ key: 'yuningxi', asset: yuningxi },
	{ key: 'kxh', asset: kxh },
	{ key: 'hyw_beta', asset: hyw },
]

async function readBundledScript(assetModule: number): Promise<string> {
	const asset = Asset.fromModule(assetModule)
	await asset.downloadAsync()
	const uri = asset.localUri || asset.uri
	if (!uri) {
		throw new Error('无法读取内嵌音源')
	}
	return FileSystem.readAsStringAsync(uri)
}

export function createBundledMusicApiStub(
	script: string,
	extras: { id: string; builtinKey: string; displayName?: string },
): IMusic.MusicApi {
	const info = parseLxMusicScriptInfo(script)
	return {
		id: extras.id,
		platform: 'tx',
		author: info.author || '',
		name: extras.displayName || info.name || extras.builtinKey,
		version: info.version || '',
		srcUrl: info.homepage || '',
		script,
		scriptType: 'lxmusic',
		isSelected: false,
		builtinKey: extras.builtinKey,
		getMusicUrl: undefined,
	}
}

export async function loadBundledMusicApiStubs(): Promise<IMusic.MusicApi[]> {
	const stubs: IMusic.MusicApi[] = []
	for (const def of BUNDLED_SOURCE_DEFS) {
		const script = await readBundledScript(def.asset)
		stubs.push(
			createBundledMusicApiStub(script, {
				id: `builtin_${def.key}`,
				builtinKey: def.key,
				displayName: def.displayName,
			}),
		)
	}
	return stubs
}
