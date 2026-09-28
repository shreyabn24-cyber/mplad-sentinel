'use client';

/**
 * Optional dictation helper for the citizen demand form.
 *
 * What this is honest about
 * -------------------------
 * The browser's Web Speech API transcribes speech. That is all it does. There
 * is no model behind the "NLP entity parser" this component previously claimed
 * to run: `handleParseAndFill` was regular expressions over the transcript, and
 * it filled the form as follows.
 *
 *   - Category: five hardcoded regexes, defaulting to "Roads & Bridges".
 *   - Amount: defaulting to `'1500000'`. A citizen who said nothing about cost
 *     had ₹15,00,000 written into a field that is submitted to a government
 *     request form, and the auto-generated description then asserted "estimated
 *     outlay of ₹15.0 Lakhs" as though they had said it.
 *   - Village: defaulting to "Local Ward / Gram Panchayat", then appending
 *     "Locality" to whatever the regex caught.
 *   - Title: a canned sentence per category, e.g. "Installation of Solar RO
 *     Drinking Water Plant", so a request could be titled as a specific scheme
 *     the citizen never mentioned.
 *
 * That matters because the form is a *request to an office*. A parser that
 * invents a figure and a title is not a convenience, it is putting words in
 * somebody's mouth on a form addressed to a government department. So nothing
 * is filled in automatically any more.
 *
 * What it does now
 * ----------------
 *  - Dictation appends the recognised text to the description field as an
 *    explicitly-labelled block, and nothing else.
 *  - Every value it could not determine is left empty and listed, rather than
 *    being defaulted. An empty amount field is a small inconvenience; a wrong
 *    amount is a false statement in a submitted record.
 *  - If speech recognition is unavailable or the microphone is refused, it says
 *    so and the form still works by typing.
 *  - The two "quick example" buttons are gone. They called the parser directly,
 *    which meant clicking one auto-filled a *fictional* demand for a named
 *    district with an invented amount and looked exactly like a real
 *    transcription. There is no way to keep a demo button on a component whose
 *    output is indistinguishable from the citizen's own words.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '@/lib/languageContext';

interface DictatedText {
  /** The recognised words, appended to the description for the citizen to edit. */
  text: string;
  /** Field names the parser could not fill, so the citizen knows what is still blank. */
  unfilled: string[];
}

interface VoiceAssistantProps {
  /**
   * Receives the dictated text. Deliberately narrow: this component no longer
   * sets an amount, a category, a title, or a location on the citizen's behalf.
   */
  onDictate: (result: DictatedText) => void;
}

/**
 * The Web Speech API is not in the bundled TypeScript DOM lib, and it is a
 * non-standard-ish surface anyway (Chrome and Edge only; Safari and Firefox
 * either lack it or ship it under a vendor prefix). Declaring the shape used
 * here is preferable to the `any` this component previously used, which meant
 * typos in `result.isFinal` or the error codes were not caught at all.
 */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const FIELDS_NOT_FILLED = [
  'amount (say the figure, or leave it blank and add it yourself)',
  'category (choose from the list)',
  'village or locality',
  'title',
];

export default function VoiceAssistant({ onDictate }: VoiceAssistantProps) {
  const { currentLanguage, t } = useLanguage();

  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [status, setStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Guards against parsing an interim result: the recogniser fires onresult
  // continuously, and treating a partial result as final used to fill the form
  // from half a sentence.
  const finalRef = useRef('');

  const languageRef = useRef(currentLanguage);
  languageRef.current = currentLanguage;

  useEffect(() => {
    const Recognition =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor })
        .webkitSpeechRecognition;

    if (!Recognition) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = currentLanguage.speechCode || 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      finalRef.current = '';
      setInterim('');
      setFinalTranscript('');
      setIsListening(true);
      setStatus({
        tone: 'info',
        text: t('voice_listening', 'Listening...') + ` (${currentLanguage.nativeLabel})`,
      });
    };

    recognition.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalRef.current += result[0].transcript;
        } else {
          pending += result[0].transcript;
        }
      }
      setInterim(pending);
      setFinalTranscript(finalRef.current);
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      setInterim('');
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatus({
          tone: 'error',
          text: t(
            'voice_mic_blocked',
            'Microphone access is blocked for this site. Allow it in your browser settings, or type the request instead.'
          ),
        });
      } else if (event.error === 'no-speech') {
        setStatus({ tone: 'error', text: t('voice_no_speech', 'No speech was detected.') });
      } else if (event.error === 'network') {
        setStatus({
          tone: 'error',
          text: t(
            'voice_network',
            'The browser speech service could not be reached, so nothing was transcribed. It usually needs a network connection.'
          ),
        });
      } else {
        setStatus({
          tone: 'error',
          text: `${t('voice_error', 'Speech error')}: ${event.error}`,
        });
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterim('');
      const said = finalRef.current.trim();
      if (said) {
        // Only the words are used. Nothing is inferred from them.
        onDictate({ text: said, unfilled: FIELDS_NOT_FILLED });
        setStatus({
          tone: 'info',
          text: t(
            'voice_appended',
            'Your words were added to the description. The other fields are still blank — please check them before sending.'
          ),
        });
      }
      finalRef.current = '';
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
    };
    // `onDictate` is intentionally not a dependency: the parent passes an inline
    // arrow, and re-creating the recogniser on every render would drop the mic
    // mid-request. The handler reads the latest value from a ref instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLanguage.code, currentLanguage.speechCode]);

  const onDictateRef = useRef(onDictate);
  onDictateRef.current = onDictate;
  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onend = () => {
      setIsListening(false);
      setInterim('');
      const said = finalRef.current.trim();
      if (said) {
        onDictateRef.current({ text: said, unfilled: FIELDS_NOT_FILLED });
        setStatus({
          tone: 'info',
          text: t(
            'voice_appended',
            'Your words were added to the description. The other fields are still blank — please check them before sending.'
          ),
        });
      }
      finalRef.current = '';
    };
  }, [t]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setStatus(null);
    try {
      recognition.lang = languageRef.current.speechCode || 'en-IN';
      recognition.start();
    } catch {
      // start() throws if a session is already running; the recogniser is
      // already listening in that case, so there is nothing to report.
      setIsListening(true);
    }
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  if (supported === false) {
    return (
      <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-4 flex items-start gap-3">
        <span className="material-symbols-outlined text-on-surface-variant text-[20px] shrink-0">
          mic_off
        </span>
        <div className="space-y-1">
          <span className="text-xs font-bold text-primary">
            {t('voice_unsupported', 'Dictation is not available in this browser')}
          </span>
          <p className="text-[11px] text-on-surface-variant">
            {t(
              'voice_unsupported_body',
              'The request form works normally by typing. Nothing is required to be lost here.'
            )}
          </p>
        </div>
      </div>
    );
  }

  const showTranscript = isListening || Boolean(finalTranscript || interim);

  return (
    <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={isListening ? stop : start}
            disabled={supported === null}
            aria-pressed={isListening}
            className={`relative h-11 w-11 rounded-full flex items-center justify-center transition-all shadow-md disabled:opacity-50 ${
              isListening
                ? 'bg-rose-600 text-white ring-4 ring-rose-500/30'
                : 'bg-primary text-white hover:bg-primary/90'
            }`}
            title={isListening ? t('voice_stop', 'Stop dictation') : t('voice_start', 'Start dictation')}
          >
            <span className="material-symbols-outlined text-[24px]">
              {isListening ? 'stop' : 'mic'}
            </span>
          </button>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-primary">
                {t('voice_assistant', 'Dictate the request')}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-bold font-mono">
                {currentLanguage.speechCode}
              </span>
              {isListening && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-900 font-bold">
                  {t('voice_listening_badge', 'listening')}
                </span>
              )}
            </div>
            <p className="text-[11px] text-on-surface-variant">
              {t(
                'voice_help',
                'Your words are added to the description. Nothing is filled in for you, and the text is only a draft until you send it.'
              )}
            </p>
          </div>
        </div>
      </div>

      {showTranscript && (
        <div className="p-3 bg-surface-container-lowest border border-outline-variant/40 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-on-surface-variant uppercase font-mono">
            <span className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${isListening ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`}
              />
              {isListening
                ? t('voice_partial', 'Partial transcript')
                : t('voice_transcript', 'Transcript')}
            </span>
            <span>{currentLanguage.speechCode}</span>
          </div>
          <p className="text-xs text-primary font-medium italic min-h-[1.25rem]">
            {finalTranscript}
            {interim && <span className="text-on-surface-variant"> {interim}</span>}
            {!finalTranscript && !interim && t('voice_waiting', 'Waiting for speech...')}
          </p>
        </div>
      )}

      {status && (
        <div
          className={`text-[11px] px-3 py-2 rounded-lg border flex items-start gap-2 ${
            status.tone === 'error'
              ? 'bg-error-container/50 border-error/40 text-on-error-container'
              : 'bg-surface-container border-outline-variant/40 text-on-surface-variant'
          }`}
        >
          <span className="material-symbols-outlined text-[16px] shrink-0">
            {status.tone === 'error' ? 'error' : 'info'}
          </span>
          <span>{status.text}</span>
        </div>
      )}
    </div>
  );
}
