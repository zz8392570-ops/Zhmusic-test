import { DOMParser } from '@xmldom/xmldom'

export type WebDavSnapshot = { date: string; fileName: string; sizeBytes?: number }

export const snapshotFileName = (date: string) => {
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
		new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
	) {
		throw new Error('Invalid snapshot date')
	}
	return `ZhMusic-${date}.json`
}

/** Only accept files directly under the requested DAV collection, never server-supplied URLs. */
export function parseWebDavSnapshots(xml: string, directory: string): WebDavSnapshot[] {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported XML declarations')
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {
				throw new Error('Malformed DAV response')
			},
			error: () => {
				throw new Error('Malformed DAV response')
			},
			fatalError: () => {
				throw new Error('Malformed DAV response')
			},
		},
	}).parseFromString(xml, 'application/xml')
	if (
		doc.documentElement?.localName !== 'multistatus' ||
		doc.documentElement.namespaceURI !== 'DAV:'
	)
		throw new Error('Invalid DAV response')
	const root = new URL(directory)
	const rows = doc.getElementsByTagNameNS('DAV:', 'response')
	const snapshots = new Map<string, WebDavSnapshot>()
	for (let index = 0; index < rows.length; index++) {
		const row = rows.item(index)!
		const href = row.getElementsByTagNameNS('DAV:', 'href').item(0)?.textContent
		if (!href) continue
		let url: URL
		try {
			url = new URL(href.trim(), directory)
		} catch {
			continue
		}
		if (
			url.origin !== root.origin ||
			url.search ||
			url.hash ||
			!url.pathname.startsWith(root.pathname)
		)
			continue
		let name: string
		try {
			name = decodeURIComponent(url.pathname.slice(root.pathname.length))
		} catch {
			continue
		}
		const match = /^ZhMusic-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)
		if (!match) continue
		try {
			snapshotFileName(match[1])
		} catch {
			continue
		}
		const properties = row.getElementsByTagNameNS('DAV:', 'propstat')
		for (let p = 0; p < properties.length; p++) {
			const propstat = properties.item(p)!
			const status = propstat.getElementsByTagNameNS('DAV:', 'status').item(0)?.textContent ?? ''
			if (!/^HTTP\/\S+\s+2\d\d(?:\s|$)/.test(status.trim())) continue
			if (propstat.getElementsByTagNameNS('DAV:', 'collection').length) continue
			const rawSize = propstat
				.getElementsByTagNameNS('DAV:', 'getcontentlength')
				.item(0)
				?.textContent?.trim()
			const size = rawSize && /^\d+$/.test(rawSize) ? Number(rawSize) : undefined
			snapshots.set(match[1], {
				date: match[1],
				fileName: name,
				sizeBytes: Number.isSafeInteger(size) ? size : undefined,
			})
		}
	}
	return [...snapshots.values()].sort((a, b) => b.date.localeCompare(a.date))
}
