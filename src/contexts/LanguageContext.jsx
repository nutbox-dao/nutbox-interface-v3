import { createContext, useContext, useState } from 'react';
import { translations } from '../utils/translations';

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    const saved = localStorage.getItem('walnut_language');
    if (saved === 'zh' || saved === 'en') return saved;
    // Auto-detect browser language, default to 'en'
    return navigator.language?.startsWith('zh') ? 'zh' : 'en';
  });

  const setLanguage = (lang) => {
    if (lang === 'zh' || lang === 'en') {
      setLanguageState(lang);
      localStorage.setItem('walnut_language', lang);
    }
  };

  // Translation helper function
  const t = (key, params = {}) => {
    const keys = key.split('.');
    let value = translations[language];
    
    for (const k of keys) {
      value = value?.[k];
    }
    
    if (!value) {
      // Fallback to English if key is missing in Chinese
      let fallback = translations['en'];
      for (const k of keys) {
        fallback = fallback?.[k];
      }
      if (fallback) value = fallback;
    }
    
    if (!value) return key;

    // Support parameterized translations (e.g. {num})
    let result = value;
    Object.entries(params).forEach(([pKey, pVal]) => {
      result = result.replace(new RegExp(`\\{${pKey}\\}`, 'g'), pVal);
    });
    
    return result;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
