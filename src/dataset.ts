import {SecretKey} from "@chainsafe/lodestar-z/blst";

export function generatePubkeys(count: number): Uint8Array[] {
  return Array.from({length: count}, (_, index) => {
    const ikm = new Uint8Array(32);
    new DataView(ikm.buffer).setUint32(0, index + 1, true);
    return SecretKey.fromKeygen(ikm).toPublicKey().toBytes();
  });
}

export function indicesFor(count: number, cacheSize: number, offset = 0): number[] {
  return Array.from({length: count}, (_, index) => (offset + index) % cacheSize);
}
