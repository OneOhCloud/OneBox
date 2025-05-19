import { createContext } from "react";

interface NavContextType {
    activeScreen: 'home' | 'configuration' | 'settings';
    setActiveScreen: (screen: 'home' | 'configuration' | 'settings') => void;
    handleLanguageChange: (lang: string) => void;
}

export const NavContext = createContext<NavContextType>({
    activeScreen: 'home',
    setActiveScreen: () => { },
    handleLanguageChange: (_: string) => { },
});