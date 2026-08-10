import {performance} from "node:perf_hooks";
import {beforeAll, bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {type BlsCache, populateCaches} from "./cacheSetup.js";
import {generatePubkeys, indicesFor} from "./dataset.js";
import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import type {TypeScriptPubkeyCache} from "./typescriptPubkeyCache.js";

const cacheSize = readPositiveInteger("CACHE_SIZE", 16_384);
const benchmarkTime = readPositiveInteger("BENCH_TIME", 1_000);
const warmupTime = readPositiveInteger("WARMUP_TIME", 250);
// Aggregate sizes 1, 32, and 128 match Lodestar's existing BLS performance tests. Size 512
// covers a full mainnet committee: 1M active validators / 32 slots / 64 committees per slot is
// about 488 members per committee.
const aggregateSizes = [1, 32, 128, 512];

if (cacheSize < Math.max(...aggregateSizes)) {
  throw new Error(`CACHE_SIZE must be at least ${Math.max(...aggregateSizes)}`);
}

let sink: unknown;

describe("pubkey cache", () => {
  // Fixed measurement and warmup time per case. minMs == maxMs reproduces the fixed-time
  // measurement of the previous tinybench setup; warmup is time-based only.
  setBenchOpts({
    minMs: benchmarkTime,
    maxMs: benchmarkTime,
    maxWarmUpMs: warmupTime,
    // Time-based warmup only; the runner rejects Infinity here.
    maxWarmUpRuns: Number.MAX_SAFE_INTEGER,
  });

  let nativeCache!: PubkeyCache;
  let typescriptCache!: TypeScriptPubkeyCache;

  beforeAll(() => {
    console.log("Generating deterministic valid BLS public keys...");
    const pubkeys = generatePubkeys(cacheSize);
    ({nativeCache, typescriptCache} = populateCaches(pubkeys));

    console.log({
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cacheSize,
      benchmarkTime,
      warmupTime,
    });

    // append() leaves the native JavaScript object cache empty. This scan measures the
    // first getOrThrow() for every key before the steady-state benchmarks warm it.
    console.table([
      measureFirstPass("TypeScript", typescriptCache),
      measureFirstPass("Zig native", nativeCache),
    ]);
    assertEquivalent(nativeCache, typescriptCache);
  });

  const lookupIndices = makeLookupSequence(cacheSize, 4_096);
  let nativeLookupCursor = 0;
  let typescriptLookupCursor = 0;
  let nativeSerializeCursor = 0;
  let typescriptSerializeCursor = 0;
  let nativeBytesCursor = 0;

  const nextLookupIndex = (cursor: number): number => lookupIndices[cursor % lookupIndices.length]!;

  bench("BLS indexed getOrThrow - TypeScript", () => {
    sink = typescriptCache.getOrThrow(nextLookupIndex(typescriptLookupCursor++));
  });
  bench("BLS indexed getOrThrow - Zig native", () => {
    sink = nativeCache.getOrThrow(nextLookupIndex(nativeLookupCursor++));
  });

  // The BLS worker job path needs Uint8Array pubkeys, so the indexed hot path is really
  // getOrThrow() + toBytes(). Compare it with the direct getPubkeyBytes() native call.
  bench("BLS indexed getOrThrow + toBytes - TypeScript", () => {
    sink = typescriptCache.getOrThrow(nextLookupIndex(typescriptSerializeCursor++)).toBytes();
  });
  bench("BLS indexed getOrThrow + toBytes - Zig native", () => {
    sink = nativeCache.getOrThrow(nextLookupIndex(nativeSerializeCursor++)).toBytes();
  });
  bench("BLS indexed getPubkeyBytes - Zig native", () => {
    sink = nativeCache.getPubkeyBytes(nextLookupIndex(nativeBytesCursor++));
  });

  for (const count of aggregateSizes) {
    const indices = indicesFor(count, cacheSize, 17);
    bench(`BLS aggregatePublicKeys ${count} - TypeScript cache`, () => {
      sink = typescriptCache.aggregate(indices);
    });
    bench(`BLS nativeCache.aggregate ${count} - Zig native cache`, () => {
      sink = nativeCache.aggregate(indices);
    });
  }

  const mixedSets = makeMixedSignatureSets(cacheSize);
  bench("BLS mixed 32 signature sets - TypeScript", () => {
    sink = runMixedWorkload(typescriptCache, mixedSets);
  });
  bench("BLS mixed 32 signature sets - Zig native", () => {
    sink = runMixedWorkload(nativeCache, mixedSets);
  });
});

function measureFirstPass(name: string, cache: BlsCache): {cache: string; totalMs: string; nsPerLookup: string} {
  let value: unknown;
  const start = performance.now();
  for (let index = 0; index < cache.size; index++) {
    value = cache.getOrThrow(index);
  }
  const elapsed = performance.now() - start;
  sink = value;
  return {
    cache: name,
    totalMs: elapsed.toFixed(3),
    nsPerLookup: ((elapsed * 1e6) / cache.size).toFixed(1),
  };
}

function makeLookupSequence(size: number, count: number): number[] {
  let state = 0x9e3779b9;
  return Array.from({length: count}, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % size;
  });
}

type SignatureSet = {type: "indexed"; index: number} | {type: "aggregate"; indices: number[]};

function makeMixedSignatureSets(size: number): SignatureSet[] {
  return Array.from({length: 32}, (_, index) => {
    if (index % 4 !== 3) {
      return {type: "indexed", index: (index * 97) % size};
    }
    const count = index % 8 === 3 ? 32 : 128;
    return {type: "aggregate", indices: indicesFor(count, size, index * 97)};
  });
}

function runMixedWorkload(cache: BlsCache, sets: SignatureSet[]): unknown {
  let value: unknown;
  for (const set of sets) {
    value = set.type === "indexed" ? cache.getOrThrow(set.index) : cache.aggregate(set.indices);
  }
  return value;
}

function assertEquivalent(nativeCache: BlsCache, typescriptCache: BlsCache): void {
  for (const count of aggregateSizes) {
    const indices = indicesFor(count, cacheSize, 17);
    const nativeBytes = nativeCache.aggregate(indices).toBytes();
    const typescriptBytes = typescriptCache.aggregate(indices).toBytes();
    if (!Buffer.from(nativeBytes).equals(Buffer.from(typescriptBytes))) {
      throw new Error(`Aggregate mismatch for ${count} public keys`);
    }
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
