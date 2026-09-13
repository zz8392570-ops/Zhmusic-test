export const MUSIC_PLATFORM_LABEL_KEYS: Record<string, string> = {
	tx: 'find.platformTx',
	kw: 'find.platformKw',
	kg: 'find.platformKg',
	wy: 'find.platformWy',
	mg: 'find.platformMg',
}

const PLATFORM_ALIASES: Record<string, string> = {
	qq: 'tx',
	qqmusic: 'tx',
	kuwo: 'kw',
	kugou: 'kg',
	netease: 'wy',
	migu: 'mg',
}

export const normalizeMusicPlatform = (platform: unknown, fallback = 'tx') => {
	if (typeof platform !== 'string' || !platform.trim()) return fallback
	const normalized = platform.trim().toLowerCase()
	return PLATFORM_ALIASES[normalized] ?? normalized
}

export const getMusicPlatformLabelKey = (platform: unknown) =>
	MUSIC_PLATFORM_LABEL_KEYS[normalizeMusicPlatform(platform)]

export const supportsCatalogNavigation = (platform: unknown) =>
	normalizeMusicPlatform(platform) === 'tx'
