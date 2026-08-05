# Lodestar pubkey cache benchmarks

This repository compares the TypeScript pubkey cache removed by Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728) with the Zig-backed cache from
lodestar-z [#522](https://github.com/ChainSafe/lodestar-z/pull/522).

The dependency on `@chainsafe/lodestar-z` is pinned to the exact commit used by Lodestar
[#9728](https://github.com/ChainSafe/lodestar/pull/9728):
`b40c1c78f2e389320c7cdeea49a7485379d3b747`.

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

## Requirements

- Node.js 22 or later.
- pnpm.
- Zig compatible with the pinned lodestar-z revision. pnpm builds the native binding during installation.
- A supported lodestar-z platform.

## Run

```sh
pnpm install
pnpm check
pnpm bench
```

Use environment variables to change the workload:

```sh
CACHE_SIZE=131072 BENCH_TIME=3000 WARMUP_TIME=1000 pnpm bench
```

- `CACHE_SIZE` defaults to `16384` and must be at least `128`.
- `BENCH_TIME` is the measurement time per benchmark in milliseconds. It defaults to `1000`.
- `WARMUP_TIME` is the warmup time per benchmark in milliseconds. It defaults to `250`.

Run benchmarks on an idle machine. Use the same Node.js version, CPU power mode, and thermal state when you
compare results. The native cache is process-wide, so do not run benchmark cases concurrently in one process.

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
