declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  interface PhonemizeModule {
    callMain(args: string[]): void;
  }
  const create: (opts: {
    print: (line: string) => void;
    printErr: (line: string) => void;
    wasmBinary: ArrayBuffer;
    getPreloadedPackage: (name: string, size: number) => ArrayBuffer;
  }) => Promise<PhonemizeModule>;
  export default create;
}
