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
- Aggregate signature set, shared JavaScript path: `indices.map(getOrThrow)` followed by
  `aggregatePublicKeys`, measured with each cache.
- Aggregate signature set, optimized native path: `aggregate(indices)`.
- A mixed batch of 32 indexed and aggregate signature sets that compares the old TypeScript path with the
  optimized native path.

Aggregate sizes are 1, 32, and 128. Lodestar's existing BLS performance tests describe 128 as a typical
mainnet attestation maximum. The mixed workload contains 24 indexed sets, four 32-key aggregate sets, and
four 128-key aggregate sets.

The script also reports a one-shot first pass over all entries. The native JavaScript wrapper lazily caches
`PublicKey` objects returned by Zig. The steady-state benchmark runs after this first pass, so both caches
return already-deserialized objects for indexed lookups.

Cache population, `getIndex`, persistence, capacity management, and reset are outside the measured BLS path.
The shared JavaScript aggregation cases isolate cache lookup overhead. The optimized native aggregation cases
measure the changed end-to-end Lodestar beacon-node path.

## Results

The following results are from one run on 2026-08-05. Lower latency is better. The tables show average
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
| TypeScript | 1.799 ms | 109.8 ns |
| Zig native | 13.237 ms | 807.9 ns |

The first native lookup pass was approximately 7.4 times slower.

### Warm indexed lookup

| Cache | Average latency |
| --- | ---: |
| TypeScript | 30.97 ns |
| Zig native | 71.55 ns |

The warm native lookup was approximately 2.3 times slower. The TypeScript cache uses a JavaScript array for
index-to-key lookup. The native wrapper uses a JavaScript `Map` after the first native lookup. The Rust
`PubkeyIndexMap` in the TypeScript implementation only serves key-to-index lookups and is not used by this
BLS path.

### BLS aggregation

The shared JavaScript path resolves each key with `getOrThrow()` and then calls `aggregatePublicKeys()`. The
optimized native path sends only validator indices to Zig through `aggregate(indices)`.

| Public keys | TypeScript cache and JS aggregate | Native cache and JS aggregate | Native `aggregate(indices)` |
| ---: | ---: | ---: | ---: |
| 1 | 1.084 us | 0.931 us | 0.054 us |
| 32 | 20.894 us | 21.118 us | 17.705 us |
| 128 | 74.228 us | 77.181 us | 63.656 us |

For 32 and 128 public keys, changing only the cache while retaining JavaScript aggregation did not improve
latency. Keeping lookup and aggregation in Zig reduced latency by approximately 15% for 32 keys and 14% for
128 keys. The one-key native case is special because the wrapper returns the cached key without running an
aggregation.

### Mixed BLS workload

Each iteration resolves 32 signature sets: 24 indexed sets, four 32-key aggregate sets, and four 128-key
aggregate sets.

| Path | Average latency per batch | Average throughput |
| --- | ---: | ---: |
| TypeScript cache and JavaScript aggregation | 374.238 us | 2,678 batches/s |
| Zig native cache and native aggregation | 317.950 us | 3,148 batches/s |

The native path reduced average mixed-workload latency by approximately 15% and increased throughput by
approximately 18%.

### Summary

Individual indexed lookups are slower through the native wrapper. Shared JavaScript aggregation performs
similarly with both caches because BLS aggregation dominates the lookup cost. The performance gain in
Lodestar [#9728](https://github.com/ChainSafe/lodestar/pull/9728) comes from `aggregate(indices)`, which keeps
public-key lookup and aggregation inside Zig and avoids returning every key through JavaScript.

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
