
import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_INSTRUCTION, SUPPORTED_LANGUAGES } from "../constants";
import { TranslationResult } from "../types";

const getAIClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const GENERATION_CONFIG = {
  systemInstruction: SYSTEM_INSTRUCTION,
  responseMimeType: "application/json",
  responseSchema: {
    type: Type.OBJECT,
    properties: {
      original_text: { type: Type.STRING },
      detected_language: { type: Type.STRING },
      translated_text: { type: Type.STRING },
      phonetic: { type: Type.STRING },
    },
    required: ["original_text", "detected_language", "translated_text"],
  },
};

// Expanded offline fallback dictionary for basic communication
const OFFLINE_DICTIONARY: Record<string, Record<string, string>> = {
  "hello": { "id": "halo", "es": "hola", "ja": "こんにちは", "zh": "你好", "en": "hello" },
  "thank you": { "id": "terima kasih", "es": "gracias", "ja": "ありがとう", "zh": "谢谢", "en": "thank you" },
  "where is the bathroom": { "id": "di mana kamar mandi", "es": "donde está el baño", "ja": "トイレはどこですか", "zh": "洗手间在哪里", "en": "where is the bathroom" },
  "help me": { "id": "tolong saya", "es": "ayúdame", "ja": "助けて", "zh": "帮帮我", "en": "help me" },
  "good morning": { "id": "selamat pagi", "es": "buenos días", "ja": "おはよう", "zh": "早上好", "en": "good morning" },
  "how much": { "id": "berapa harganya", "es": "cuánto cuesta", "ja": "いくらですか", "zh": "多少钱", "en": "how much" },
  "i am lost": { "id": "saya tersesat", "es": "estoy perdido", "ja": "迷いました", "zh": "我迷路了", "en": "i am lost" },
  "water": { "id": "air", "es": "agua", "ja": "水", "zh": "水", "en": "water" },
  "food": { "id": "makanan", "es": "comida", "ja": "食べ物", "zh": "食物", "en": "food" },
  "yes": { "id": "ya", "es": "sí", "ja": "はい", "zh": "是", "en": "yes" },
  "no": { "id": "tidak", "es": "no", "ja": "いいえ", "zh": "不", "en": "no" },
};

const handleGenAIError = (error: any) => {
  const message = error?.message || "";
  if (message.includes("SAFETY")) {
    throw new Error("Safety Block: The content was flagged as inappropriate for translation.");
  }
  if (message.includes("429") || message.includes("quota")) {
    throw new Error("Limit Reached: The translation engine is currently over capacity. Please try again in a few seconds.");
  }
  if (message.includes("RECITATION")) {
    throw new Error("Recitation Block: The engine detected copyrighted material and cannot translate it.");
  }
  throw error;
};

export const translateOffline = async (text: string, targetLangCode: string): Promise<TranslationResult> => {
  const cleanText = text.toLowerCase().trim().replace(/[?.!]/g, "");
  
  // Try to find exact match or partial match in dictionary
  let translation = OFFLINE_DICTIONARY[cleanText]?.[targetLangCode];
  
  if (!translation) {
    // Basic heuristic: check if any key is contained in the text
    const foundKey = Object.keys(OFFLINE_DICTIONARY).find(key => cleanText.includes(key));
    if (foundKey) {
      translation = OFFLINE_DICTIONARY[foundKey][targetLangCode];
    }
  }

  return {
    original_text: text,
    detected_language: "en", // Assuming source is En for offline survival mode
    translated_text: translation || `[Offline: ${text}]`,
    phonetic: ""
  };
};

export const translateAudio = async (
  base64Audio: string, 
  targetLanguageName: string,
  motherLanguageName: string,
  mimeType: string = 'audio/webm'
): Promise<TranslationResult> => {
  try {
    const ai = getAIClient();
    const finalMimeType = mimeType || 'audio/webm';
    const langList = SUPPORTED_LANGUAGES.map(l => l.name).join(", ");
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: finalMimeType,
                data: base64Audio,
              },
            },
            {
              text: `Universal Detection Task:
Supported Languages: [${langList}]
User Preferred Language (Mother): ${motherLanguageName}
Active Target Language: ${targetLanguageName}

Operation:
1. Detect which language is being spoken from the Supported Languages list.
2. If the speaker uses ${motherLanguageName}, translate to ${targetLanguageName}.
3. If the speaker uses any other language, translate to ${motherLanguageName}.
Ensure high precision in auto-detection.`,
            },
          ],
        },
      ],
      config: GENERATION_CONFIG,
    });

    const text = response.text;
    if (!text) throw new Error("The translation engine returned an empty response.");
    return JSON.parse(text) as TranslationResult;
  } catch (err) {
    throw handleGenAIError(err);
  }
};

export const translateText = async (
  inputText: string,
  targetLanguageName: string,
  motherLanguageName: string
): Promise<TranslationResult> => {
  try {
    const ai = getAIClient();
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            {
              text: `The user's mother language is ${motherLanguageName}. Input Text: "${inputText}"\nTranslate this text to ${targetLanguageName}. If the input text is already in ${targetLanguageName}, translate it back to ${motherLanguageName}. Use auto-detection.`,
            },
          ],
        },
      ],
      config: GENERATION_CONFIG,
    });

    const text = response.text;
    if (!text) throw new Error("The translation engine returned an empty response.");
    return JSON.parse(text) as TranslationResult;
  } catch (err) {
    throw handleGenAIError(err);
  }
};

export const translateImage = async (
  base64Image: string,
  targetLanguageName: string,
  motherLanguageName: string,
  mimeType: string = 'image/jpeg'
): Promise<TranslationResult> => {
  try {
    const ai = getAIClient();
    
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Image,
              },
            },
            {
              text: `The user's mother language is ${motherLanguageName}. Extract all visible text from this image and translate it to ${targetLanguageName}. If the extracted text is in ${targetLanguageName}, translate it to ${motherLanguageName}.`,
            },
          ],
        },
      ],
      config: GENERATION_CONFIG,
    });

    const text = response.text;
    if (!text) throw new Error("The translation engine returned an empty response.");
    return JSON.parse(text) as TranslationResult;
  } catch (err) {
    throw handleGenAIError(err);
  }
};
