import assert from "node:assert/strict";
import {after, test} from "node:test";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {populateCaches} from "../src/cacheSetup.js";
import {generatePubkeys, indicesFor} from "../src/dataset.js";

after(() => pubkeyCache.reset());

test("both caches return the same indexed public keys", () => {
  const pubkeys = generatePubkeys(16);
  const {nativeCache, typescriptCache} = populateCaches(pubkeys);

  for (let index = 0; index < pubkeys.length; index++) {
    assert.deepEqual(nativeCache.getOrThrow(index).toBytes(), typescriptCache.getOrThrow(index).toBytes());
    assert.deepEqual(nativeCache.getPubkeyBytes(index), typescriptCache.getOrThrow(index).toBytes());
  }
});

test("both BLS paths return the same aggregate", () => {
  const pubkeys = generatePubkeys(256);
  const {nativeCache, typescriptCache} = populateCaches(pubkeys);

  for (const count of [1, 32, 128, 256]) {
    const indices = indicesFor(count, pubkeys.length, 7);
    assert.deepEqual(nativeCache.aggregate(indices).toBytes(), typescriptCache.aggregate(indices).toBytes());
  }
});
