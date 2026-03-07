declare module 'typo-js' {
  class Typo {
    constructor(lang: string, affData?: string, dicData?: string, options?: any);
    check(word: string): boolean;
    suggest(word: string, limit?: number): string[];
  }
  export default Typo;
}
