export type Verbosity = 'terse' | 'balanced' | 'detailed';

export interface RoutingHint {
  phrase: string;
  intent: string;
}

export interface VerbosityPrefs {
  briefing?: Verbosity;
  plan?: Verbosity;
  humanize?: Verbosity;
}

export interface PreferenceProfile {
  tone: string[];
  verbosity: VerbosityPrefs;
  priorities: string[];
  doNot: string[];
  routingHints: RoutingHint[];
}

export const EMPTY_PROFILE: PreferenceProfile = {
  tone: [],
  verbosity: {},
  priorities: [],
  doNot: [],
  routingHints: [],
};

export interface ListDiff {
  add?: string[];
  remove?: string[];
}

export interface RoutingHintDiff {
  add?: RoutingHint[];
  remove?: string[]; // phrase 로 제거
}

export interface PreferenceDiff {
  tone?: ListDiff;
  verbosity?: VerbosityPrefs;
  priorities?: ListDiff;
  doNot?: ListDiff;
  routingHints?: RoutingHintDiff;
}

export type PreferenceSection = 'briefing' | 'humanize' | 'routing';
