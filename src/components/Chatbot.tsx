import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Send, X, Bot, User, Zap, Loader2, Sparkles } from 'lucide-react';
import { type Language, translations } from '@/lib/translations';
import { type MonitoringData } from '@/lib/monitoringData';
import ReactMarkdown from 'react-markdown';

interface ChatbotProps {
  language: Language;
  monitoringData?: MonitoringData;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function Chatbot({ language, monitoringData }: ChatbotProps) {
  const t = translations[language];
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Reset on language change
  useEffect(() => {
    setMessages([]);
  }, [language]);

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: 'user', content: msg };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          messages: newMessages,
          monitoringData,
          language,
        }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: language === 'en'
          ? 'Connection error. For emergencies, call 112.'
          : 'कनेक्शन त्रुटि। आपातकाल के लिए 112 पर कॉल करें।'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const quickButtons = [
    { label: t.quickBeachSafe, query: t.quickBeachSafe },
    { label: t.quickTsunami, query: t.quickTsunami },
    { label: t.quickEvacuation, query: t.quickEvacuation },
    { label: t.quickEmergency, query: t.quickEmergency },
  ];

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 p-4 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90 transition-colors"
        aria-label="Open BayWatch AI Assistant"
      >
        <MessageCircle className="w-6 h-6" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-4 sm:right-6 z-50 w-[360px] sm:w-[400px] max-w-[calc(100vw-2rem)] glass-card rounded-2xl border-primary/20 overflow-hidden flex flex-col"
            style={{ maxHeight: '550px' }}
          >
            <div className="flex items-center justify-between p-4 border-b border-border bg-card/90">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/20">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="font-semibold text-sm flex items-center gap-1">
                    {t.chatbotTitle}
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">AI</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-safe animate-pulse" />
                    <span className="text-[10px] text-muted-foreground">Online</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors" aria-label="Close chat">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick buttons */}
            <div className="p-2 border-b border-border flex gap-1.5 flex-wrap">
              {quickButtons.map((btn, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(btn.query)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                >
                  <Zap className="w-3 h-3" />
                  {btn.label}
                </button>
              ))}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '350px' }}>
              {messages.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <Bot className="w-8 h-8 mx-auto mb-2 text-primary/40" />
                  <p>{t.chatbotPlaceholder}</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                      <Bot className="w-3 h-3 text-primary" />
                    </div>
                  )}
                  <div className={`text-sm p-3 rounded-xl max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-secondary text-secondary-foreground rounded-bl-sm prose prose-sm prose-invert max-w-none'
                  }`}>
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
                      <User className="w-3 h-3" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot className="w-3 h-3 text-primary" />
                  </div>
                  <div className="bg-secondary p-3 rounded-xl rounded-bl-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-border flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={t.chatbotPlaceholder}
                className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading}
                className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
