import { Injectable } from '@angular/core';

export interface AbbreviationError {
  word: string;
  index: number;
  length: number;
  formal: string;
}

@Injectable({ providedIn: 'root' })
export class AbbreviationDictionaryService {

  private readonly dictionary = new Map<string, string>([
    ['u', 'you'],
    ['uat', 'uat'],
    ['usr', 'user'],
    ['bcoz', 'because'],
    ['ur', 'your'],
    ['r', 'are'],
    ['gr8', 'great'],
    ['pls', 'please'],
    ['plz', 'please'],
    ['thx', 'thanks'],
    ['thnx', 'thanks'],
    ['btw', 'by the way'],
    ['omg', 'oh my god'],
    ['cuz', 'because'],
    ['gonna', 'going to'],
    ['wanna', 'want to'],
    ['gotta', 'got to'],
    ['idk', "I don't know"],
    ['imo', 'in my opinion'],
    ['tbh', 'to be honest'],
    ['nvm', 'never mind'],
    ['lol', 'laughing out loud'],
    ['brb', 'be right back'],
    ['msg', 'message'],
    ['txt', 'text'],
    ['pic', 'picture'],
    ['ppl', 'people'],
    ['rn', 'right now'],
    ['b4', 'before'],
    ['2day', 'today'],
    ['tmr', 'tomorrow'],
    ['yr', 'year'],
    ['cud', 'could'],
    ['shud', 'should'],
    ['wud', 'would'],
    ['dat', 'that'],
    ['dem', 'them'],
    ['dis', 'this'],
    ['dnt', "don't"],
    ['cnt', "can't"],
    ['hw', 'how'],
    ['wen', 'when'],
    ['abt', 'about'],
    ['bcz', 'because'],
    ['bday', 'birthday'],
    ['convo', 'conversation'],
    ['fav', 'favorite'],
    ['info', 'information'],
    ['perf', 'perfect'],
    ['prob', 'probably'],
    ['srsly', 'seriously'],
    ['tho', 'though'],
    ['thru', 'through'],
    ['ty', 'thank you'],
    ['np', 'no problem'],
    ['teh', 'the'],
    ['bcoz', 'because'],
    ['coz', 'because'],
    ['altho', 'although'],
    ['ya', 'yes'],
    ['yep', 'yes'],
    ['nope', 'no'],
    ['ok', 'okay'],
    ['kk', 'okay'],
    ['okie', 'okay'],
    ['bt', 'but'],
    ['btt', 'but'],
    ['nd', 'and'],
    ['n', 'and'],
    ['mins', 'minutes'],
    ['sec', 'second'],
    ['secs', 'seconds'],
    ['dept', 'department'],
    ['approx', 'approximately'],
    ['addr', 'address'],
    ['admin', 'administrator'],
    ['mgmt', 'management'],
    ['ops', 'operations'],
    ['proj', 'project'],
    ['dev', 'development'],
    ['config', 'configuration'],
    ['env', 'environment'],
    ['prod', 'production'],
    ['repo', 'repository'],
    ['2nite', 'tonight'],
    ['b4', 'before'],
    ['asap', 'as soon as possible'],
    ['fyi', 'for your information'],
  ]);

  private readonly ignoredAbbreviations = new Set<string>();
  private readonly dictionaryAdditions = new Set<string>();

  private static readonly STORAGE_KEY = 'abbreviation_dictionary_ignored';

  constructor() {
    this.loadDictionaryAdditions();
  }

  checkText(text: string): AbbreviationError[] {
    const errors: AbbreviationError[] = [];
    const regex = /[a-zA-Z'0-9]+/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const word = match[0];
      const lower = word.toLowerCase();

      if (this.ignoredAbbreviations.has(lower) || this.dictionaryAdditions.has(lower)) {
        continue;
      }

      const formal = this.dictionary.get(lower);
      if (formal) {
        errors.push({
          word,
          index: match.index,
          length: word.length,
          formal: this.matchCase(word, formal)
        });
      }
    }

    return errors;
  }

  getFormal(word: string): string | undefined {
    const lower = word.toLowerCase();
    if (this.ignoredAbbreviations.has(lower) || this.dictionaryAdditions.has(lower)) {
      return undefined;
    }
    const formal = this.dictionary.get(lower);
    return formal ? this.matchCase(word, formal) : undefined;
  }

  ignore(word: string): void {
    this.ignoredAbbreviations.add(word.toLowerCase());
  }

  addToDictionary(word: string): void {
    const lower = word.toLowerCase();
    this.dictionaryAdditions.add(lower);
    this.saveDictionaryAdditions();
  }

  resetIgnored(): void {
    this.ignoredAbbreviations.clear();
  }

  private matchCase(source: string, target: string): string {
    if (source === source.toUpperCase() && source.length > 1) {
      return target.toUpperCase();
    }
    if (source[0] === source[0].toUpperCase()) {
      return target.charAt(0).toUpperCase() + target.slice(1);
    }
    return target;
  }

  private loadDictionaryAdditions(): void {
    try {
      const stored = localStorage.getItem(AbbreviationDictionaryService.STORAGE_KEY);
      if (stored) {
        const words: string[] = JSON.parse(stored);
        words.forEach(w => this.dictionaryAdditions.add(w));
      }
    } catch { /* ignore parse errors */ }
  }

  private saveDictionaryAdditions(): void {
    try {
      localStorage.setItem(
        AbbreviationDictionaryService.STORAGE_KEY,
        JSON.stringify([...this.dictionaryAdditions])
      );
    } catch { /* ignore storage errors */ }
  }
}
