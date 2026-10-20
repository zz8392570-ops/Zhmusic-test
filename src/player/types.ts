/** ZhMusic's library/display record. Native MediaItem is only a transport projection. */
export interface Track extends Partial<IMusic.IMusicItem> {
	id: string
	/** Equivalent search hits from other providers, kept for manual source selection. */
	sourceAlternatives?: Track[]
	/** User explicitly split this recording from other platforms. */
	favoriteKeepSeparate?: boolean
	availablePlatforms?: string[]
	headers?: Record<string, string>
	userAgent?: string
	isLiveStream?: boolean
	contentType?: string
}
