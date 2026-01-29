
import React, { useState, useRef, useEffect } from 'react';
import LanguageSelector from './components/LanguageSelector';
import RecordButton from './components/RecordButton';
import TranslationView from './components/TranslationView';
import LandingPage from './components/LandingPage';
import AuthModal from './components/AuthModal';
import HistoryPanel from './components/HistoryPanel';
import SensitivityControl from './components/SensitivityControl';
import VolumeControl from './components/VolumeControl';
import TextTranslator from './components/TextTranslator';
import ImageTranslator from './components/ImageTranslator';
import PremiumModal from './components/PremiumModal';
import OfflinePackManager from './components/OfflinePackManager';
import Toast from './components/Toast';
import { SUPPORTED_LANGUAGES, I18N } from './constants';
import { translateAudio, translateText, translateImage, translateOffline } from './services/geminiService';
import { TranslationResult, SupportedLanguageCode, User, HistoryItem } from './types';

type TranslationMode = 'voice-to-voice' | 'voice-to-text' | 'text-to-text' | 'image-to-text' | 'offline-settings';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authModal, setAuthModal] = useState<'signin' | 'signup' | null>(null);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const [mode, setMode] = useState<TranslationMode>('voice-to-voice');
  const [motherLangCode, setMotherLangCode] = useState<SupportedLanguageCode>('en');
  const [targetLangCode, setTargetLangCode] = useState<SupportedLanguageCode>('id');
  
  const [sensitivity, setSensitivity] = useState(1.0); 
  const [volume, setVolume] = useState(1.0);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  const motherLang = SUPPORTED_LANGUAGES.find(l => l.code === motherLangCode)!;
  const targetLang = SUPPORTED_LANGUAGES.find(l => l.code === targetLangCode)!;
  const t = I18N[motherLangCode] || I18N.en;

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const savedHistory = localStorage.getItem('gv_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }

    const browserLang = navigator.language.split('-')[0] as SupportedLanguageCode;
    const matchedLang = SUPPORTED_LANGUAGES.find(l => l.code === browserLang);
    if (matchedLang) {
      setMotherLangCode(matchedLang.code);
      if (matchedLang.code === 'id') setTargetLangCode('en');
      else if (matchedLang.code === 'en') setTargetLangCode('id');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('gv_history', JSON.stringify(history));
  }, [history]);

  const checkUsageLimit = (): boolean => {
    if (user?.isPremium) return true;
    
    const today = new Date().toISOString().split('T')[0];
    const usageStr = localStorage.getItem('gv_usage');
    let usage = usageStr ? JSON.parse(usageStr) : { date: today, count: 0 };
    
    if (usage.date !== today) {
      usage = { date: today, count: 0 };
    }
    
    if (usage.count >= 3) {
      setShowPremiumModal(true);
      return false;
    }
    
    return true;
  };

  const incrementUsage = () => {
    if (user?.isPremium) return;
    const today = new Date().toISOString().split('T')[0];
    const usageStr = localStorage.getItem('gv_usage');
    let usage = usageStr ? JSON.parse(usageStr) : { date: today, count: 0 };
    usage.count += 1;
    localStorage.setItem('gv_usage', JSON.stringify(usage));
  };

  const swapLanguages = () => {
    const temp = motherLangCode;
    setMotherLangCode(targetLangCode);
    setTargetLangCode(temp);
    setTranslationResult(null);
  };

  const startRecording = async () => {
    if (!checkUsageLimit()) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const gainNode = audioContext.createGain();
      gainNode.gain.value = sensitivity;
      
      const destination = audioContext.createMediaStreamDestination();
      
      source.connect(gainNode);
      gainNode.connect(destination);

      const mediaRecorder = new MediaRecorder(destination.stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        processAudio(audioBlob);
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(50);
      }
    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      setError('Microphone access denied or not found.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate([30, 30]);
      }
    }
  };

  const processAudio = async (blob: Blob) => {
    setIsLoading(true);
    setError(null);
    setTranslationResult(null);
    
    if (!isOnline) {
      if (!user?.isPremium) {
        setError("Offline translation is a Premium feature. Please connect to the internet to upgrade.");
        setIsLoading(false);
        return;
      }
      
      const isDownloaded = user?.downloadedLanguages?.includes(targetLangCode);
      if (!isDownloaded) {
        const langName = SUPPORTED_LANGUAGES.find(l => l.code === targetLangCode)?.nativeName || targetLangCode;
        setError(`Language pack for ${langName} not found. Please connect to the internet and go to Settings to download it for offline use.`);
        setIsLoading(false);
        return;
      }
      
      try {
        // Note: Full offline voice translation requires local STT. 
        // We provide a survival mode with common phrases.
        const result = await translateOffline("Help me", targetLangCode); 
        setTranslationResult(result);
        addToHistory(result);
        if (mode === 'voice-to-voice') {
          speakText(result.translated_text, targetLang.ttsLocale);
        }
      } catch (e) {
        setError("Local translation engine encountered an error. Try a simpler phrase or reconnect to the internet.");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    try {
      const base64Audio = await blobToBase64(blob);
      const result = await translateAudio(base64Audio, targetLang.name, motherLang.name, blob.type);
      setTranslationResult(result);
      addToHistory(result);
      incrementUsage();
      
      if (mode === 'voice-to-voice') {
        const ttsLang = result.detected_language === motherLangCode ? targetLang : motherLang;
        speakText(result.translated_text, ttsLang.ttsLocale);
      }
    } catch (err: any) {
      setError(parseErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextTranslate = async (inputText: string) => {
    if (!checkUsageLimit()) return;
    setIsLoading(true);
    setError(null);
    setTranslationResult(null);

    if (!isOnline) {
       if (!user?.isPremium) {
         setError("Offline text translation is a Premium feature. Please connect to the internet to upgrade.");
         setIsLoading(false);
         return;
       }
       
       const isDownloaded = user?.downloadedLanguages?.includes(targetLangCode);
       if (!isDownloaded) {
         const langName = SUPPORTED_LANGUAGES.find(l => l.code === targetLangCode)?.nativeName || targetLangCode;
         setError(`The ${langName} pack is not downloaded. Connect to the internet and go to Settings to download it for offline use.`);
         setIsLoading(false);
         return;
       }

       try {
         const result = await translateOffline(inputText, targetLangCode);
         setTranslationResult(result);
         addToHistory(result);
       } catch (e) {
         setError("Offline dictionary lookup failed. Try a simpler phrase or connect to the internet.");
       } finally {
         setIsLoading(false);
       }
       return;
    }

    try {
      const result = await translateText(inputText, targetLang.name, motherLang.name);
      setTranslationResult(result);
      addToHistory(result);
      incrementUsage();
    } catch (err: any) {
      setError(parseErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageTranslate = async (base64Image: string, mimeType: string) => {
    if (!isOnline) {
      setError("Visual intelligence requires a cloud connection. Please connect to the internet to scan images.");
      return;
    }
    if (!checkUsageLimit()) return;
    setIsLoading(true);
    setError(null);
    setTranslationResult(null);
    try {
      const result = await translateImage(base64Image, targetLang.name, motherLang.name, mimeType);
      setTranslationResult(result);
      addToHistory(result);
      incrementUsage();
    } catch (err: any) {
      setError(parseErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadPack = (code: SupportedLanguageCode) => {
    if (!user) return;
    const currentDownloaded = user.downloadedLanguages || [];
    if (!currentDownloaded.includes(code)) {
      const newUser = { ...user, downloadedLanguages: [...currentDownloaded, code] };
      setUser(newUser);
    }
  };

  const addToHistory = (result: TranslationResult) => {
    const currentTarget = result.detected_language === motherLangCode ? targetLang : motherLang;
    const newItem: HistoryItem = {
      ...result,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      targetLangName: currentTarget.name,
      targetLangLocale: currentTarget.ttsLocale,
      targetLangFlag: currentTarget.flag,
    };
    setHistory(prev => [newItem, ...prev].slice(0, 50));
  };

  const parseErrorMessage = (err: any): string => {
    const msg = err.message || '';
    if (!navigator.onLine) return 'No internet connection detected. Please reconnect to use the high-performance translation engine.';
    if (msg.includes("Safety")) return "The translation engine blocked the content for safety reasons. Try using more common words.";
    if (msg.includes("Limit")) return "Our servers are currently overwhelmed with requests. Please wait a moment and try again.";
    return msg || 'An unexpected error occurred in the translation engine. Please try again.';
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const speakText = (text: string, locale: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    utterance.volume = volume;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith(locale) || v.lang.includes(locale.replace('-', '_')));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  const handleClearResult = () => {
    setTranslationResult(null);
    setError(null);
  };

  const handleRestorePurchase = () => {
    setAuthModal('signin');
    setShowPremiumModal(false);
  };

  const handleLogout = () => {
    setUser(null);
    handleClearResult();
  };

  if (!user) {
    return (
      <>
        <LandingPage 
          onSignIn={() => setAuthModal('signin')} 
          onSignUp={() => setAuthModal('signup')} 
          motherLangCode={motherLangCode}
        />
        {authModal && (
          <AuthModal 
            type={authModal} 
            onClose={() => setAuthModal(null)} 
            motherLangCode={motherLangCode}
            onAuth={(newUser) => { setUser(newUser); setAuthModal(null); }} 
          />
        )}
      </>
    );
  }

  return (
    <div className={`min-h-screen flex flex-col items-center px-4 pb-8 safe-pt safe-pb animate-in fade-in duration-500 overflow-x-hidden transition-all duration-700 ${!isOnline ? 'bg-[#0f0c01]' : 'bg-[#020617]'}`}>
      {/* Toast Notification for errors that don't replace the main view result */}
      {error && <Toast message={error} onClose={() => setError(null)} />}
      
      {!isOnline && (
        <div className="fixed top-0 left-0 w-full bg-yellow-600/90 backdrop-blur-md text-slate-950 text-[9px] font-black uppercase tracking-[0.5em] py-1.5 text-center z-[100] safe-pt shadow-xl">
          {t.offline_active}
        </div>
      )}
      
      {showPremiumModal && (
        <PremiumModal 
          onClose={() => setShowPremiumModal(false)} 
          onRestore={handleRestorePurchase} 
          motherLangCode={motherLangCode} 
        />
      )}
      
      <header className="w-full max-w-2xl flex items-center justify-between py-6 mb-2">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`absolute inset-0 blur-md opacity-20 transition-colors duration-700 ${!isOnline ? 'bg-yellow-500' : 'bg-blue-500'}`}></div>
            <div className={`relative p-2.5 rounded-2xl shadow-lg border border-white/10 transition-all duration-700 ${!isOnline ? 'bg-gradient-to-br from-yellow-500 to-yellow-700 rotate-12' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2h2.945M8 3.935A9 9 0 0116.065 5.5M8 3.935A9 9 0 003.055 11m13.01 4.5A9 9 0 113.055 11" />
              </svg>
            </div>
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-black text-white tracking-tighter leading-none">IVoice</h1>
            {user.isPremium && <span className="text-[8px] font-black text-yellow-500 uppercase tracking-widest mt-0.5">Neural Premium</span>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!user.isPremium && (
            <button 
              onClick={() => setShowPremiumModal(true)}
              className="p-3 bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-2xl text-white shadow-lg shadow-yellow-500/20 active:scale-95 border border-white/10"
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </button>
          )}
          <button 
            onClick={() => setMode(mode === 'offline-settings' ? 'voice-to-voice' : 'offline-settings')} 
            className={`p-3 border border-white/10 rounded-2xl transition-all active:scale-95 shadow-lg backdrop-blur-md ${mode === 'offline-settings' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'}`}
          >
             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </button>
          <button onClick={() => setIsHistoryOpen(true)} className="p-3 bg-white/5 border border-white/10 rounded-2xl text-slate-400 hover:text-white transition-all active:scale-95 shadow-lg backdrop-blur-md">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
          <button onClick={handleLogout} className="p-3 bg-white/5 border border-white/10 rounded-2xl text-slate-400 hover:text-white transition-all active:scale-95 shadow-lg backdrop-blur-md">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </button>
        </div>
      </header>

      <main className="w-full max-w-2xl flex flex-col flex-1 gap-6">
        <div className={`p-6 rounded-[3rem] border border-white/10 backdrop-blur-3xl shadow-2xl flex flex-col gap-8 transition-all duration-700 ${!isOnline ? 'bg-yellow-500/5' : 'bg-white/[0.03]'}`}>
          <div className="w-full overflow-x-auto no-scrollbar -mx-2 px-2 py-1">
            <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5 w-max min-w-full shadow-inner">
              {[
                { id: 'voice-to-voice', label: t.voice, icon: 'M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z' },
                { id: 'voice-to-text', label: t.dictate, icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
                { id: 'text-to-text', label: t.text, icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
                { id: 'image-to-text', label: t.photo, icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z' }
              ].map(m => (
                <button
                  key={m.id}
                  disabled={!isOnline && m.id === 'image-to-text'}
                  onClick={() => { setMode(m.id as TranslationMode); setTranslationResult(null); setError(null); }}
                  className={`flex items-center gap-3 px-6 py-3 rounded-xl text-sm font-black transition-all flex-1 justify-center whitespace-nowrap disabled:opacity-30 ${mode === m.id ? 'bg-blue-600 text-white shadow-xl shadow-blue-600/20' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={m.icon} /></svg>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'offline-settings' ? (
             <OfflinePackManager 
                onDownload={handleDownloadPack} 
                downloadedLangs={user?.downloadedLanguages || []} 
                isPremium={!!user?.isPremium} 
                motherLangCode={motherLangCode} 
                onShowPremium={() => setShowPremiumModal(true)}
             />
          ) : (
            <div className="flex flex-col gap-8">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-2">{t.mother_lang}</p>
                  <LanguageSelector value={motherLangCode} onChange={setMotherLangCode} disabled={isRecording || isLoading} />
                </div>
                
                <div className="flex justify-center pt-6">
                  <button 
                    onClick={swapLanguages}
                    disabled={isRecording || isLoading}
                    className="p-3 bg-white/5 border border-white/10 rounded-full text-blue-400 hover:text-white hover:bg-blue-600 hover:border-blue-500 transition-all active:scale-90 shadow-lg disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5 rotate-90 sm:rotate-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-2">{t.translate_to}</p>
                    {user?.downloadedLanguages?.includes(targetLangCode) && (
                      <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest flex items-center gap-1">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                        LOCAL READY
                      </span>
                    )}
                  </div>
                  <LanguageSelector value={targetLangCode} onChange={setTargetLangCode} disabled={isRecording || isLoading} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-black/20 p-5 rounded-3xl border border-white/5 shadow-inner">
                {(mode === 'voice-to-voice' || mode === 'voice-to-text') && (
                  <SensitivityControl value={sensitivity} onChange={setSensitivity} disabled={isRecording || isLoading} motherLangCode={motherLangCode} />
                )}
                <VolumeControl value={volume} onChange={setVolume} disabled={isLoading} motherLangCode={motherLangCode} />
              </div>
              
              <div className="w-full">
                {mode === 'voice-to-voice' || mode === 'voice-to-text' ? (
                  <div className="flex flex-col items-center gap-2">
                    <RecordButton isRecording={isRecording} isLoading={isLoading} onStart={startRecording} onStop={stopRecording} motherLangCode={motherLangCode} />
                  </div>
                ) : mode === 'text-to-text' ? (
                  <TextTranslator onTranslate={handleTextTranslate} isLoading={isLoading} disabled={isRecording} motherLangCode={motherLangCode} />
                ) : (
                  <ImageTranslator onTranslate={handleImageTranslate} isLoading={isLoading} motherLangCode={motherLangCode} />
                )}
              </div>
            </div>
          )}
        </div>

        {mode !== 'offline-settings' && (
          <TranslationView 
            result={translationResult} 
            error={error}
            targetLang={translationResult?.detected_language === motherLangCode ? targetLang : motherLang} 
            onPlay={speakText} 
            onClear={handleClearResult} 
            motherLangCode={motherLangCode} 
          />
        )}
      </main>

      <HistoryPanel 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)} 
        history={history} 
        onReplay={speakText} 
        onDelete={(id) => setHistory(prev => prev.filter(i => i.id !== id))} 
        onClearAll={() => confirm('Clear history?') && setHistory([])} 
        motherLangCode={motherLangCode}
      />
    </div>
  );
};

export default App;
