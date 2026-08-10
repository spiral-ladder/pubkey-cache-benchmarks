# Lodestar pubkey cache benchmarks

This repository compares the TypeScript pubkey cache removed by Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728) with the Zig-backed cache from
lodestar-z [#522](https://github.com/ChainSafe/lodestar-z/pull/522).

The dependency on `@chainsafe/lodestar-z` is pinned to commit
`d479f339a643c8673f719cbcaa7d0d4a6a79bfe6`, which adds the native `getPubkeyBytes()` binding on top of
lodestar-z `main`. The commit originally used by Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728) is
`b40c1c78f2e389320c7cdeea49a7485379d3b747`.

## Run

```sh
pnpm install
```

The install builds the pinned lodestar-z native binding with the mainnet preset and `ReleaseSafe`
optimization.

Run the type check and correctness tests:

```sh
pnpm check
```

Run the benchmark with its default configuration:

```sh
pnpm bench
```

Use environment variables to change the workload:

```sh
CACHE_SIZE=131072 BENCH_TIME=3000 WARMUP_TIME=1000 pnpm bench
```

- `CACHE_SIZE` defaults to `16384` and must be at least `512`.
- `BENCH_TIME` is the measurement time per benchmark in milliseconds. It defaults to `1000`.
- `WARMUP_TIME` is the warmup time per benchmark in milliseconds. It defaults to `250`.

To save a result, create the ignored results directory and pipe the output to `tee`:

```sh
mkdir -p results
pnpm bench | tee "results/$(date +%Y-%m-%d).txt"
```

Run benchmarks on an idle machine. Use the same Node.js version, CPU power mode, and thermal state when you
compare results. The native cache is process-wide, so do not run benchmark cases concurrently in one process.

## Results

### Summary

- Slower: The first native `getOrThrow()` pass was 7.1x slower.
- Slower: A warm native `getOrThrow()` was 2.3x slower, or about 39 ns slower.
- Neutral: With the `toBytes()` serialize included, the native indexed path was within 7% of the
  TypeScript path. Serialize dominates the lookup regression.
- Faster: Native `getPubkeyBytes()` had 26% lower latency than native `getOrThrow()` + `toBytes()`
  on the [BLS worker path](#indexed-pubkey-bytes-for-the-bls-worker).
- Faster: Native aggregation of 32 keys had 13% lower latency.
- Faster: Native aggregation of 128 keys had 20% lower latency.
- Faster: Native aggregation of 512 keys had 15% lower latency.
- Faster: The [native mixed workload](#mixed-bls-workload) had 15% lower latency and 17% higher throughput.

Sample output from my machine:

```
Generating deterministic valid BLS public keys...
{
  node: 'v24.18.0',
  platform: 'darwin-arm64',
  cacheSize: 16384,
  benchmarkTime: 1000,
  warmupTime: 250
}
┌─────────┬──────────────┬──────────┬─────────────┐
│ (index) │ cache        │ totalMs  │ nsPerLookup │
├─────────┼──────────────┼──────────┼─────────────┤
│ 0       │ 'TypeScript' │ '1.681'  │ '102.6'     │
│ 1       │ 'Zig native' │ '11.891' │ '725.8'     │
└─────────┴──────────────┴──────────┴─────────────┘
┌─────────┬────────────────────────────────────────────────────┬───────────────────┬───────────────────┬────────────────────────┬────────────────────────┬──────────┐
│ (index) │ Task name                                          │ Latency avg (ns)  │ Latency med (ns)  │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples  │
├─────────┼────────────────────────────────────────────────────┼───────────────────┼───────────────────┼────────────────────────┼────────────────────────┼──────────┤
│ 0       │ 'BLS indexed getOrThrow - TypeScript'              │ '31.20 ± 0.02%'   │ '41.00 ± 1.00'    │ '26023218 ± 0.00%'     │ '24390243 ± 580719'    │ 32052958 │
│ 1       │ 'BLS indexed getOrThrow - Zig native'              │ '70.26 ± 0.03%'   │ '83.00 ± 1.00'    │ '16161942 ± 0.02%'     │ '12048193 ± 143431'    │ 14232916 │
│ 2       │ 'BLS indexed getOrThrow + toBytes - TypeScript'    │ '719.08 ± 3.17%'  │ '584.00 ± 1.00'   │ '1609906 ± 0.03%'      │ '1712329 ± 2937'       │ 1390670  │
│ 3       │ 'BLS indexed getOrThrow + toBytes - Zig native'    │ '769.07 ± 2.09%'  │ '625.00 ± 41.00'  │ '1493843 ± 0.03%'      │ '1600000 ± 98498'      │ 1300276  │
│ 4       │ 'BLS indexed getPubkeyBytes - Zig native'          │ '571.87 ± 2.44%'  │ '458.00 ± 41.00'  │ '2117966 ± 0.03%'      │ '2183406 ± 183406'     │ 1748635  │
│ 5       │ 'BLS aggregatePublicKeys 1 - TypeScript cache'     │ '829.14 ± 12.24%' │ '667.00 ± 1.00'   │ '1470877 ± 0.02%'      │ '1499250 ± 2251'       │ 1206070  │
│ 6       │ 'BLS nativeCache.aggregate 1 - Zig native cache'   │ '53.76 ± 0.04%'   │ '42.00 ± 1.00'    │ '20550558 ± 0.01%'     │ '23809524 ± 580720'    │ 18600664 │
│ 7       │ 'BLS aggregatePublicKeys 32 - TypeScript cache'    │ '20083 ± 0.03%'   │ '20000 ± 83.00'   │ '49823 ± 0.02%'        │ '50000 ± 208'          │ 49793    │
│ 8       │ 'BLS nativeCache.aggregate 32 - Zig native cache'  │ '17469 ± 0.03%'   │ '17417 ± 83.00'   │ '57290 ± 0.02%'        │ '57415 ± 272'          │ 57245    │
│ 9       │ 'BLS aggregatePublicKeys 128 - TypeScript cache'   │ '77753 ± 1.55%'   │ '71875 ± 208.00'  │ '13662 ± 0.17%'        │ '13913 ± 40'           │ 12863    │
│ 10      │ 'BLS nativeCache.aggregate 128 - Zig native cache' │ '62332 ± 0.58%'   │ '61292 ± 250.00'  │ '16216 ± 0.08%'        │ '16315 ± 67'           │ 16044    │
│ 11      │ 'BLS aggregatePublicKeys 512 - TypeScript cache'   │ '281173 ± 0.04%'  │ '280334 ± 458.00' │ '3557 ± 0.03%'         │ '3567 ± 6'             │ 3557     │
│ 12      │ 'BLS nativeCache.aggregate 512 - Zig native cache' │ '237644 ± 0.03%'  │ '237042 ± 375.00' │ '4208 ± 0.03%'         │ '4219 ± 7'             │ 4208     │
│ 13      │ 'BLS mixed 32 signature sets - TypeScript'         │ '370281 ± 0.07%'  │ '368583 ± 1333.0' │ '2701 ± 0.06%'         │ '2713 ± 10'            │ 2701     │
│ 14      │ 'BLS mixed 32 signature sets - Zig native'         │ '315691 ± 0.10%'  │ '315834 ± 3668.0' │ '3170 ± 0.09%'         │ '3166 ± 37'            │ 3168     │
└─────────┴────────────────────────────────────────────────────┴───────────────────┴───────────────────┴────────────────────────┴────────────────────────┴──────────┘
```

## Methodology

The benchmarks focus on the cache operations used to resolve Lodestar BLS signature sets:

- Indexed signature set: `getOrThrow(index)`.
- Indexed signature set for the BLS worker: `getOrThrow(index)` + `toBytes()` compared with the
  native `getPubkeyBytes(index)`. The worker consumes `Uint8Array` pubkeys, not `PublicKey` objects.
- Old aggregate signature path: `indices.map(getOrThrow)` followed by `aggregatePublicKeys`.
- New aggregate signature path: `nativeCache.aggregate(indices)`.
- A mixed batch of 32 indexed and aggregate signature sets that compares the old TypeScript path with the
  optimized native path.

Aggregate sizes are 1, 32, 128, and 512. Lodestar's existing BLS performance tests describe 128 as a
typical mainnet attestation maximum. Size 512 covers a full committee at 1M active validators:
1M validators / 32 slots / 64 committees per slot gives about 488 members per committee. The mixed
workload contains 24 indexed sets, four 32-key aggregate sets, and four 128-key aggregate sets.

The script also reports a one-shot first pass over all entries. The native JavaScript wrapper lazily caches
`PublicKey` objects returned by Zig. The steady-state benchmark runs after this first pass, so both caches
return already-deserialized objects for indexed lookups.

Cache population, `getIndex`, persistence, capacity management, and reset are outside the measured BLS path.
The aggregation cases compare the old and new end-to-end Lodestar beacon-node paths.


### First indexed lookup pass

This pass calls `getOrThrow()` once for every cached key. The TypeScript cache already stores deserialized
`PublicKey` objects. The native JavaScript wrapper creates and memoizes a `PublicKey` wrapper on the first
lookup.

| Cache | Total | Average per lookup |
| --- | ---: | ---: |
| TypeScript | 1.681 ms | 102.6 ns |
| Zig native | 11.891 ms | 725.8 ns |

The first native lookup pass was approximately 7.1 times slower.

### Warm indexed lookup

| Cache | Average latency |
| --- | ---: |
| TypeScript | 31.20 ns |
| Zig native | 70.26 ns |

The warm native lookup was approximately 2.3 times slower. The TypeScript cache uses a JavaScript array for
index-to-key lookup. The native wrapper uses a JavaScript `Map` after the first native lookup. The Rust
`PubkeyIndexMap` in the TypeScript implementation only serves key-to-index lookups and is not used by this
BLS path.

### Indexed pubkey bytes for the BLS worker

The Lodestar BLS worker consumes `Uint8Array` pubkeys, so the indexed hot path for SingleAttestation
gossip validation is `getOrThrow(index)` + `toBytes()`, not `getOrThrow(index)` alone. The native
`getPubkeyBytes(index)` copies the cached 48-byte compressed pubkey directly and skips both the
`PublicKey` wrapper and the serialize call.

| Path | Average latency |
| --- | ---: |
| TypeScript `getOrThrow` + `toBytes` | 719 ns |
| Zig native `getOrThrow` + `toBytes` | 769 ns |
| Zig native `getPubkeyBytes` | 572 ns |

With the serialize included, the native indexed path was only 7% slower than the TypeScript path. The
native `getPubkeyBytes()` path was 26% faster than native `getOrThrow()` + `toBytes()` and 20% faster
than the TypeScript path.

### BLS aggregation

The old path resolves each key from the TypeScript cache and then calls `aggregatePublicKeys()`. The new path
sends only validator indices to Zig through `nativeCache.aggregate(indices)`.

| Public keys | Old `aggregatePublicKeys` path | New `nativeCache.aggregate` path |
| ---: | ---: | ---: |
| 1 | 0.829 us | 0.054 us |
| 32 | 20.083 us | 17.469 us |
| 128 | 77.753 us | 62.332 us |
| 512 | 281.173 us | 237.644 us |

Keeping lookup and aggregation in Zig reduced latency by approximately 13% for 32 keys, 20% for 128 keys,
and 15% for 512 keys. The 32-key improvement varies between 13% and 23% across runs because the
JavaScript path has occasional GC spikes. The one-key native case is special because the wrapper returns
the cached key without running an aggregation.

### Mixed BLS workload

Each iteration resolves 32 signature sets: 24 indexed sets, four 32-key aggregate sets, and four 128-key
aggregate sets.

| Path | Average latency per batch | Average throughput |
| --- | ---: | ---: |
| TypeScript cache and JavaScript aggregation | 370.281 us | 2,701 batches/s |
| Zig native cache and native aggregation | 315.691 us | 3,170 batches/s |

The native path reduced average mixed-workload latency by approximately 15% and increased throughput by
approximately 17%.

### Hardware and software

| Item | Value |
| --- | --- |
| Machine | Apple `Mac14,9` |
| CPU | Apple M2 Pro, 8 performance cores and 4 efficiency cores |
| Memory | 32 GiB |
| Power | AC power |
| Architecture | arm64 |
| Operating system | macOS 15.5 |
| Node.js | 24.18.0 |
| pnpm | 11.0.0 |
| Zig | 0.16.0 |
| Cache size | 16,384 public keys |
| Measurement time | 1,000 ms per case |
| Warmup time | 250 ms per case |



## Implementation sources

- TypeScript baseline: Lodestar base commit `4b7de5240bf3590426226c0f6976827a32d63dfd`,
  `packages/state-transition/src/cache/pubkeyCache.ts`.
- Old BLS aggregate path: the same commit,
  `packages/beacon-node/src/chain/bls/utils.ts`.
- Native BLS aggregate path: Lodestar [#9728](https://github.com/ChainSafe/lodestar/pull/9728) head
  `c7bd622d38fa76611d19adff96bfc3b4b9f52c65`,
  `packages/beacon-node/src/chain/bls/utils.ts`.
- Native cache wrapper: lodestar-z commit `d479f339a643c8673f719cbcaa7d0d4a6a79bfe6`,
  `bindings/src/pubkeys.js` and `bindings/napi/pubkeys.zig`.
