import {PublicKey, aggregatePublicKeys} from "@chainsafe/lodestar-z/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";

/** The pubkey cache from Lodestar before PR #9728, with its BLS aggregate call path. */
export class TypeScriptPubkeyCache {
  private readonly pubkeyToIndex = new PubkeyIndexMap();
  private readonly indexToPubkey: (PublicKey | undefined)[] = [];

  get size(): number {
    return this.pubkeyToIndex.size;
  }

  get(index: number): PublicKey | undefined {
    return this.indexToPubkey[index];
  }

  getOrThrow(index: number): PublicKey {
    const pubkey = this.get(index);
    if (pubkey === undefined) {
      throw new Error(`Missing pubkey for validator index ${index}`);
    }
    return pubkey;
  }

  getIndex(pubkey: Uint8Array): number | null {
    return this.pubkeyToIndex.get(pubkey);
  }

  set(index: number, pubkey: Uint8Array): void {
    this.pubkeyToIndex.set(pubkey, index);
    this.indexToPubkey[index] = PublicKey.fromBytes(pubkey);
  }

  /** This reproduces the old Lodestar BLS path in chain/bls/utils.ts. */
  aggregate(indices: number[]): PublicKey {
    return aggregatePublicKeys(indices.map((index) => this.getOrThrow(index)));
  }
}
