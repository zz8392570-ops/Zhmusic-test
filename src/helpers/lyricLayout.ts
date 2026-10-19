/** Measured heights with lazy prefix sums; unmeasured rows use the same estimate everywhere. */
export const createLyricLayout = (count: number, estimatedHeight: number) => {
	const heights = new Map<number, number>()
	const offsets = [0]
	let headerHeight = 0
	const rowHeight = (index: number) => heights.get(index) ?? estimatedHeight
	const rowOffset = (index: number) => {
		while (offsets.length <= index) {
			const previous = offsets.length - 1
			offsets.push(offsets[previous] + rowHeight(previous))
		}
		return offsets[index]
	}
	return {
		setHeaderHeight(height: number) {
			if (Number.isFinite(height) && height >= 0) headerHeight = height
		},
		setHeight(index: number, height: number) {
			if (index < 0 || index >= count || !Number.isFinite(height) || height <= 0) return
			if (heights.get(index) === height) return
			heights.set(index, height)
			offsets.length = Math.min(offsets.length, index + 1)
		},
		getItemLayout(_: unknown, index: number) {
			return { index, length: rowHeight(index), offset: headerHeight + rowOffset(index) }
		},
		indexAt(offset: number) {
			let low = 0
			let high = count
			while (low < high) {
				const middle = Math.floor((low + high) / 2)
				if (headerHeight + rowOffset(middle + 1) <= offset) low = middle + 1
				else high = middle
			}
			return Math.max(0, Math.min(low, count - 1))
		},
	}
}
