# Lodestar pubkey cache benchmarks

This repository compares the TypeScript pubkey cache removed by Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728) with the Zig-backed cache from
lodestar-z [#522](https://github.com/ChainSafe/lodestar-z/pull/522).

The dependency on `@chainsafe/lodestar-z` is pinned to the exact commit used by Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728):
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

- `CACHE_SIZE` defaults to `16384` and must be at least `128`.
- `BENCH_TIME` is the measurement time per benchmark in milliseconds. It defaults to `1000`.
- `WARMUP_TIME` is the warmup time per benchmark in milliseconds. It defaults to `250`.

To save a result, create the ignored results directory and pipe the output to `tee`:

```sh
mkdir -p results
pnpm bench | tee "results/$(date +%Y-%m-%d).txt"
```

Run benchmarks on an idle machine. Use the same Node.js version, CPU power mode, and thermal state when you
compare results. The native cache is process-wide, so do not run benchmark cases concurrently in one process.


## Scope

The benchmarks focus on the cache operations used to resolve Lodestar BLS signature sets:

- Indexed signature set: `getOrThrow(index)`.
- Old aggregate signature path: `indices.map(getOrThrow)` followed by `aggregatePublicKeys`.
- New aggregate signature path: `nativeCache.aggregate(indices)`.
- A mixed batch of 32 indexed and aggregate signature sets that compares the old TypeScript path with the
  optimized native path.

Aggregate sizes are 1, 32, and 128. Lodestar's existing BLS performance tests describe 128 as a typical
mainnet attestation maximum. The mixed workload contains 24 indexed sets, four 32-key aggregate sets, and
four 128-key aggregate sets.

The script also reports a one-shot first pass over all entries. The native JavaScript wrapper lazily caches
`PublicKey` objects returned by Zig. The steady-state benchmark runs after this first pass, so both caches
return already-deserialized objects for indexed lookups.

Cache population, `getIndex`, persistence, capacity management, and reset are outside the measured BLS path.
The aggregation cases compare the old and new end-to-end Lodestar beacon-node paths.

## Results

Sample output from my machine:

```
➜ pnpm bench
$ node --expose-gc --import tsx src/benchmark.ts
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
│ 0       │ 'TypeScript' │ '1.722'  │ '105.1'     │
│ 1       │ 'Zig native' │ '12.935' │ '789.5'     │
└─────────┴──────────────┴──────────┴─────────────┘
┌─────────┬────────────────────────────────────────────────────┬───────────────────┬───────────────────┬────────────────────────┬────────────────────────┬──────────┐
│ (index) │ Task name                                          │ Latency avg (ns)  │ Latency med (ns)  │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples  │
├─────────┼────────────────────────────────────────────────────┼───────────────────┼───────────────────┼────────────────────────┼────────────────────────┼──────────┤
│ 0       │ 'BLS indexed getOrThrow - TypeScript'              │ '30.34 ± 0.46%'   │ '41.00 ± 1.00'    │ '26568958 ± 0.01%'     │ '24390243 ± 580719'    │ 32963608 │
│ 1       │ 'BLS indexed getOrThrow - Zig native'              │ '69.34 ± 0.09%'   │ '83.00 ± 1.00'    │ '16835323 ± 0.02%'     │ '12048193 ± 143431'    │ 14422082 │
│ 2       │ 'BLS aggregatePublicKeys 1 - TypeScript cache'     │ '896.09 ± 11.97%' │ '667.00 ± 41.00'  │ '1481316 ± 0.02%'      │ '1499250 ± 86821'      │ 1115960  │
│ 3       │ 'BLS nativeCache.aggregate 1 - Zig native cache'   │ '51.58 ± 0.12%'   │ '42.00 ± 0.00'    │ '21371084 ± 0.01%'     │ '23809524 ± 4'         │ 19386873 │
│ 4       │ 'BLS aggregatePublicKeys 32 - TypeScript cache'    │ '20318 ± 0.15%'   │ '19875 ± 375.00'  │ '49654 ± 0.06%'        │ '50314 ± 968'          │ 49218    │
│ 5       │ 'BLS nativeCache.aggregate 32 - Zig native cache'  │ '17739 ± 0.30%'   │ '17041 ± 166.00'  │ '57155 ± 0.06%'        │ '58682 ± 577'          │ 56375    │
│ 6       │ 'BLS aggregatePublicKeys 128 - TypeScript cache'   │ '74494 ± 0.86%'   │ '71833 ± 1125.0'  │ '13670 ± 0.12%'        │ '13921 ± 215'          │ 13424    │
│ 7       │ 'BLS nativeCache.aggregate 128 - Zig native cache' │ '62608 ± 0.13%'   │ '61000 ± 1417.0'  │ '16055 ± 0.10%'        │ '16393 ± 390'          │ 15973    │
│ 8       │ 'BLS mixed 32 signature sets - TypeScript'         │ '377256 ± 0.31%'  │ '372250 ± 7625.0' │ '2661 ± 0.19%'         │ '2686 ± 55'            │ 2651     │
│ 9       │ 'BLS mixed 32 signature sets - Zig native'         │ '319348 ± 0.17%'  │ '316250 ± 7229.0' │ '3137 ± 0.14%'         │ '3162 ± 72'            │ 3132     │
└─────────┴────────────────────────────────────────────────────┴───────────────────┴───────────────────┴────────────────────────┴────────────────────────┴──────────┘
```

The following results are from one run. Lower latency is better. The tables show average
latency. Results can change with CPU load, temperature, and runtime versions.

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

### First indexed lookup pass

This pass calls `getOrThrow()` once for every cached key. The TypeScript cache already stores deserialized
`PublicKey` objects. The native JavaScript wrapper creates and memoizes a `PublicKey` wrapper on the first
lookup.

| Cache | Total | Average per lookup |
| --- | ---: | ---: |
| TypeScript | 1.722 ms | 105.1 ns |
| Zig native | 12.935 ms | 789.5 ns |

The first native lookup pass was approximately 7.5 times slower.

### Warm indexed lookup

| Cache | Average latency |
| --- | ---: |
| TypeScript | 30.34 ns |
| Zig native | 69.34 ns |

The warm native lookup was approximately 2.3 times slower. The TypeScript cache uses a JavaScript array for
index-to-key lookup. The native wrapper uses a JavaScript `Map` after the first native lookup. The Rust
`PubkeyIndexMap` in the TypeScript implementation only serves key-to-index lookups and is not used by this
BLS path.

### BLS aggregation

The old path resolves each key from the TypeScript cache and then calls `aggregatePublicKeys()`. The new path
sends only validator indices to Zig through `nativeCache.aggregate(indices)`.

| Public keys | Old `aggregatePublicKeys` path | New `nativeCache.aggregate` path |
| ---: | ---: | ---: |
| 1 | 0.896 us | 0.052 us |
| 32 | 20.318 us | 17.739 us |
| 128 | 74.494 us | 62.608 us |

Keeping lookup and aggregation in Zig reduced latency by approximately 13% for 32 keys and 16% for 128 keys.
The one-key native case is special because the wrapper returns the cached key without running an aggregation.

### Mixed BLS workload

Each iteration resolves 32 signature sets: 24 indexed sets, four 32-key aggregate sets, and four 128-key
aggregate sets.

| Path | Average latency per batch | Average throughput |
| --- | ---: | ---: |
| TypeScript cache and JavaScript aggregation | 377.256 us | 2,661 batches/s |
| Zig native cache and native aggregation | 319.348 us | 3,137 batches/s |

The native path reduced average mixed-workload latency by approximately 15% and increased throughput by
approximately 18%.

### Summary

Individual indexed lookups are slower through the native wrapper. The aggregation gain in Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728) comes from `aggregate(indices)`, which keeps public-key
lookup and aggregation inside Zig and avoids returning every key through JavaScript.

## Implementation sources

- TypeScript baseline: Lodestar base commit `4b7de5240bf3590426226c0f6976827a32d63dfd`,
  `packages/state-transition/src/cache/pubkeyCache.ts`.
- Old BLS aggregate path: the same commit,
  `packages/beacon-node/src/chain/bls/utils.ts`.
- Native BLS aggregate path: Lodestar [#9728](https://github.com/ChainSafe/lodestar/pull/9728) head
  `c7bd622d38fa76611d19adff96bfc3b4b9f52c65`,
  `packages/beacon-node/src/chain/bls/utils.ts`.
- Native cache wrapper: lodestar-z commit `b40c1c78f2e389320c7cdeea49a7485379d3b747`,
  `bindings/src/pubkeys.js` and `bindings/napi/pubkeys.zig`.
