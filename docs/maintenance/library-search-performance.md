# Personal library search performance

The favorites screen builds a normalized search index when search opens and rebuilds it
when the library snapshot changes. Closing search releases that index. Repeated queries
reuse normalized playlist names, song metadata and platform/song identity keys.

Matching still uses NFKC and case normalization, searches title/artist/album, preserves
collection order, and deduplicates results by platform and song ID. Different metadata
on copies of the same song is matched independently before collecting memberships.

Run from the repository root with the pinned Node version:

```sh
node scripts/benchmark-library-search.mjs
node scripts/benchmark-library-search.mjs --unique
```

Both scenarios use 20 collections with 1,000 songs each, five query patterns, a warm-up
and 100 measured queries. Default data shares 1,000 identities across collections;
`--unique` uses 20,000 distinct identities. Output includes index construction time,
mean and p95 query time, and a result count. Timing is informational, not a CI threshold.

Observed on the Linux cloud instance with Node 24.19.0:

| Scenario | Index build | Mean query | p95 query |
| --- | --- | --- | --- |
| 20,000 occurrences / 1,000 identities | 29.1 ms | 1.64 ms | 3.05 ms |
| 20,000 occurrences / 20,000 identities | 38.4 ms | 3.24 ms | 12.46 ms |

The previous helper averaged 21.4 ms per query on the default dataset in an initial
measurement. These are synthetic Node measurements, not Hermes or device rendering
measurements. Index construction trades initial work and memory for cheaper subsequent
queries. The screen still renders matching song rows eagerly; a query matching many
thousands of songs can therefore remain expensive to render. Device profiling and
virtualizing those rows are separate follow-up work. No input debounce was added.

The Ubuntu quality workflow also exports the iOS JavaScript/Hermes bundle after lint,
type checking and core regressions. This checks Metro resolution and Hermes compilation;
it does not replace the macOS workflow's native checks or IPA build.
