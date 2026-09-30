import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return !document.documentElement.classList.contains('light');
    }
    return true;
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
    localStorage.setItem('baywatch-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    const saved = localStorage.getItem('baywatch-theme');
    if (saved === 'light') setIsDark(false);
  }, []);

  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={() => setIsDark(d => !d)}
      className="flex items-center justify-center w-9 h-9 rounded-lg glass-card hover:border-primary/50 transition-colors"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-warning" />
      ) : (
        <Moon className="w-4 h-4 text-primary" />
      )}
    </motion.button>
  );
}
