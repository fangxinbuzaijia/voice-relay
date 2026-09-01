/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "libsodium-wrappers" {
  interface SodiumKeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    keyType?: string;
  }

  interface SodiumApi {
    ready: Promise<void>;
    base64_variants: { ORIGINAL: number };
    crypto_box_keypair(): SodiumKeyPair;
    crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
    crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
    from_base64(value: string, variant?: number): Uint8Array;
    to_base64(value: Uint8Array, variant?: number): string;
  }

  const sodium: SodiumApi;
  export default sodium;
}
