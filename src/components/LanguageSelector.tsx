import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { type Language, languageNames } from '@/lib/translations';
import { stopSpeech } from '@/voice/speech';

interface LanguageSelectorProps {
  language: Language;
  onChange: (lang: Language) => void;
}

const langConfirmation: Record<Language, string> = {
  en: 'Language Selected: English',
  hi: 'भाषा चयनित: हिन्दी',
  mr: 'भाषा निवडली: मराठी',
  gu: 'ભાષા પસંદ: ગુજરાતી',
};

export function LanguageSelector({ language, onChange }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();
  const langs = Object.entries(languageNames) as [Language, string][];

  const handleChange = (code: Language) => {
    // Switching language must not leave an utterance running in the old
    // language. Uses the single shared speech engine so both the ElevenLabs
    // element and the browser synthesis are stopped.
    stopSpeech();
    onChange(code);
    setOpen(false);
    setShowConfirm(true);
    clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setShowConfirm(false), 2500);
  };

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  return (
    <>
      <div className="relative" role="listbox" aria-label="Language selection">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-2 glass-card text-sm font-medium hover:border-primary/50 transition-colors"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Language: ${languageNames[language]}`}
        >
          <Globe className="w-4 h-4 text-primary" aria-hidden="true" />
          <span>{languageNames[language]}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-0 top-full mt-1 glass-card overflow-hidden z-50 min-w-[140px]"
          >
            {langs.map(([code, name]) => (
              <button
                key={code}
                onClick={() => handleChange(code)}
                role="option"
                aria-selected={code === language}
                className={`flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm hover:bg-secondary/50 transition-colors ${
                  code === language ? 'text-primary bg-primary/10' : 'text-foreground'
                }`}
              >
                {code === language && <Check className="w-3 h-3" />}
                {name}
              </button>
            ))}
          </motion.div>
        )}
      </div>

      {/* Language confirmation indicator */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-16 right-4 z-50 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium shadow-lg flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            {langConfirmation[language]}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
