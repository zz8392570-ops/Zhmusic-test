/** ZhMusic's library/display record. Native MediaItem is only a transport projection. */
export interface Track extends Partial<IMusic.IMusicItem> {
	id: string
	/** Equivalent search hits from other providers, kept for manual source selection. */
	sourceAlternatives?: Track[]
	/** User explicitly split this recording from other platforms. */
	favoriteKeepSeparate?: boolean
	availablePlatforms?: string[]
	/** Keep an automatic platform fallback at its original business-queue position. */
	playbackQueueOrigin?: Pick<Track, 'id' | 'platform'>
	headers?: Record<string, string>
	userAgent?: string
	isLiveStream?: boolean
	contentType?: string
}
