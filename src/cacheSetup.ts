import {pubkeyCache as nativePubkeyCache, type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {TypeScriptPubkeyCache} from "./typescriptPubkeyCache.js";

export type BlsCache = Pick<PubkeyCache, "get" | "getOrThrow" | "aggregate" | "size">;

export function populateCaches(pubkeys: Uint8Array[]): {
  nativeCache: PubkeyCache;
  typescriptCache: TypeScriptPubkeyCache;
} {
  nativePubkeyCache.reset();
  nativePubkeyCache.ensureCapacity(pubkeys.length);

  const typescriptCache = new TypeScriptPubkeyCache();
  for (const [index, pubkey] of pubkeys.entries()) {
    nativePubkeyCache.append(index, pubkey);
    typescriptCache.set(index, pubkey);
  }

  return {nativeCache: nativePubkeyCache, typescriptCache};
}
