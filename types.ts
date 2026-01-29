
export interface TranslationResult {
  original_text: string;
  detected_language: string;
  translated_text: string;
  phonetic?: string;
}

export type SupportedLanguageCode = 'en' | 'id' | 'zh' | 'es' | 'ko' | 'ja' | 'nl' | 'ar';

export interface LanguageOption {
  code: SupportedLanguageCode;
  name: string;
  nativeName: string;
  ttsLocale: string;
  flag: string;
}

export interface User {
  email: string;
  name: string;
  isPremium?: boolean;
  downloadedLanguages?: SupportedLanguageCode[];
}

export interface HistoryItem extends TranslationResult {
  id: string;
  timestamp: number;
  targetLangName: string;
  targetLangLocale: string;
  targetLangFlag: string;
}

export interface OfflinePack {
  code: SupportedLanguageCode;
  name: string;
  size: string;
  isDownloaded: boolean;
}
