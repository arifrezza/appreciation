import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import Typo from 'typo-js';

export interface SpellError {
  word: string;
  index: number;
  length: number;
}

@Injectable({ providedIn: 'root' })
export class SpellCheckService {
  private typo: any = null;
  private loaded = false;
  private customWords: Set<string> = new Set();
  private ignoredWords: Set<string> = new Set();

  private readonly defaultCustomWords = [
    'jira', 'confluence', 'devops', 'scala', 'microservice', 'microservices',
    'api', 'apis', 'backend', 'frontend', 'fullstack', 'sre', 'oauth',
    'webpack', 'npm', 'github', 'gitlab', 'bitbucket', 'kubernetes', 'docker',
    'mongodb', 'postgresql', 'redis', 'graphql', 'restful', 'json', 'yaml',
    'typescript', 'javascript', 'angular', 'nginx', 'linux', 'UAT', 'sql',
    'dropdown', 'checkbox', 'tooltip', 'navbar', 'sidebar', 'signup', 'login',
    'async', 'sync', 'refactor', 'refactored', 'codebase', 'repo','ci', 'cd', 'pipeline',
    'build', 'deploy', 'staging', 'production', 'debug', 'cicd', 'terraform', 'jenkins', 'aws',
    'azure', 'lamda', 'cors', 'saas', 'autoscaling', 'gcp', 'ec2', 's3', 'lambda', 'cloudwatch', 'kinesis', 'rds', 'vpc',
    'bigquery', 'dataproc', 'cloudrun', 'bigdata', 'hadoop', 'spark', 'kafka', 'zookeeper', 'pagination', 'caching', 'cache',
    'queue', 'queues', 'cron', 'webhook', 'webhooks', 'indexing', 'sharding', 'nosql', 'query', 'queries', 'token',
    'tokens', 'jwt', 'sso', 'saml', 'csrf', 'xss', 'ddos', 'hashing', 'ui', 'ux', 'props', 'rendering', 'lazyload', 'bundling',
    'sprint', 'backlog', 'scrum', 'epic', 'unittest', 'e2e', 'e2etest', 'mocking', 'testcase', 'testcases', 'testcoverage', 'bugfix', 'bugfixes',
    'patch', 'rollback', 'hotfix', 'dependency', 'dependencies', 'monorepo', 'monolithic', 'rebase', 'middleware', 'uptime', 'downtime',
    'dom', 'virtualdom', 'seo', 'datawarehouse', 'datapipeline','onboarding', 'java', 'kotlin', 'python', 'go', 'golang', 'php', 'ruby', 'swift',
    'C++', 'csharp', 'dotnet', '.net', 'rust', 'scala', 'elixir', 'erlang', 'clojure', 'haskell', 'fsharp', 'dart', 'flutter', 'C#', 'ceo', 'cto',
    'jenkin','ci-cd','ci/cd','CodePipeline','agentic','impactful','centric'
  ];

  constructor(private http: HttpClient) {}

  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      Promise.all([
        this.http.get('assets/dictionaries/en_US.aff', { responseType: 'text' }).toPromise(),
        this.http.get('assets/dictionaries/en_US.dic', { responseType: 'text' }).toPromise()
      ]).then(([affData, dicData]) => {
        this.typo = new Typo('en_US', affData, dicData, { platform: 'any' });
        this.loadCustomDictionary();
        this.loaded = true;
        resolve();
      }).catch(err => {
        console.error('Failed to load spell check dictionaries:', err);
        reject(err);
      });
    });
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  check(word: string): boolean {
    if (!this.loaded) return true;
    const lower = word.toLowerCase();
    if (this.customWords.has(lower)) return true;
    if (this.ignoredWords.has(lower)) return true;
    return this.typo.check(word);
  }

  suggest(word: string): string[] {
    if (!this.loaded) return [];
    return (this.typo.suggest(word) as string[]).slice(0, 5);
  }

  checkText(text: string): SpellError[] {
    if (!this.loaded) return [];
    const errors: SpellError[] = [];
    const regex = /[a-zA-Z']+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const word = match[0];
      // Skip single chars, all-caps acronyms (2 chars), words starting/ending with apostrophe
      if (word.length <= 1) continue;
      if (word.startsWith("'") || word.endsWith("'")) continue;
      if (/^\d+$/.test(word)) continue;
      if (/\d/.test(word)) continue;

      if (!this.check(word)) {
        errors.push({ word, index: match.index, length: word.length });
      }
    }
    return errors;
  }

  addToDictionary(word: string): void {
    this.customWords.add(word.toLowerCase());
    this.saveCustomDictionary();
  }

  ignore(word: string): void {
    this.ignoredWords.add(word.toLowerCase());
  }

  resetIgnored(): void {
    this.ignoredWords.clear();
  }

  private loadCustomDictionary(): void {
    this.defaultCustomWords.forEach(w => this.customWords.add(w));
    try {
      const saved = localStorage.getItem('custom_dictionary');
      if (saved) {
        JSON.parse(saved).forEach((w: string) => this.customWords.add(w.toLowerCase()));
      }
    } catch {
      // ignore parse errors
    }
  }

  private saveCustomDictionary(): void {
    const userWords = [...this.customWords].filter(w => !this.defaultCustomWords.includes(w));
    localStorage.setItem('custom_dictionary', JSON.stringify(userWords));
  }
}
