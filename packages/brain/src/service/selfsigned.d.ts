/**
 * Minimal ambient types for the `selfsigned` package (pure-JS, ships no types we
 * rely on). Declares only the synchronous `generate` surface the brain uses.
 */
declare module "selfsigned" {
  interface SelfSignedAttr {
    name: string;
    value: string;
  }
  interface SelfSignedExtension {
    name: string;
    [key: string]: unknown;
  }
  interface SelfSignedOptions {
    days?: number;
    keySize?: number;
    algorithm?: string;
    extensions?: SelfSignedExtension[];
  }
  interface SelfSignedResult {
    private: string;
    public: string;
    cert: string;
    fingerprint: string;
  }
  function generate(attrs?: SelfSignedAttr[], options?: SelfSignedOptions): SelfSignedResult;
  const selfsigned: { generate: typeof generate };
  export default selfsigned;
}
