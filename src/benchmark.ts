import {performance} from "node:perf_hooks";
import {Bench} from "tinybench";
import {populateCaches, type BlsCache} from "./cacheSetup.js";
import {generatePubkeys, indicesFor} from "./dataset.js";

const cacheSize = readPositiveInteger("CACHE_SIZE", 16_384);
const benchmarkTime = readPositiveInteger("BENCH_TIME", 1_000);
const warmupTime = readPositiveInteger("WARMUP_TIME", 250);
const aggregateSizes = [1, 32, 128];

if (cacheSize < Math.max(...aggregateSizes)) {
  throw new Error(`CACHE_SIZE must be at least ${Math.max(...aggregateSizes)}`);
}

console.log("Generating deterministic valid BLS public keys...");
const pubkeys = generatePubkeys(cacheSize);
const {nativeCache, typescriptCache} = populateCaches(pubkeys);

let sink: unknown;
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

const bench = new Bench({time: benchmarkTime, warmupTime});
const lookupIndices = makeLookupSequence(cacheSize, 4_096);
let nativeLookupCursor = 0;
let typescriptLookupCursor = 0;

bench.add("BLS indexed getOrThrow - TypeScript", () => {
  sink = typescriptCache.getOrThrow(lookupIndices[typescriptLookupCursor++ % lookupIndices.length]!);
});
bench.add("BLS indexed getOrThrow - Zig native", () => {
  sink = nativeCache.getOrThrow(lookupIndices[nativeLookupCursor++ % lookupIndices.length]!);
});

for (const count of aggregateSizes) {
  const indices = indicesFor(count, cacheSize, 17);
  bench.add(`BLS aggregatePublicKeys ${count} - TypeScript cache`, () => {
    sink = typescriptCache.aggregate(indices);
  });
  bench.add(`BLS nativeCache.aggregate ${count} - Zig native cache`, () => {
    sink = nativeCache.aggregate(indices);
  });
}

const mixedSets = makeMixedSignatureSets(cacheSize);
bench.add("BLS mixed 32 signature sets - TypeScript", () => {
  sink = runMixedWorkload(typescriptCache, mixedSets);
});
bench.add("BLS mixed 32 signature sets - Zig native", () => {
  sink = runMixedWorkload(nativeCache, mixedSets);
});

globalThis.gc?.();
await bench.run();
console.table(bench.table());

// Keep returned native wrappers observable through the end of the run.
if (sink === undefined) {
  throw new Error("Benchmark did not run");
}

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
