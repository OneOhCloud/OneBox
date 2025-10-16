import { createContext } from "react";



export type ActiveScreenType = 'home' | 'configuration' | 'settings' | 'developer_options' | 'router_settings';



interface NavContextType {
    activeScreen: ActiveScreenType;
    setActiveScreen: (screen: ActiveScreenType) => void;
    handleLanguageChange: (lang: string) => void;
}

export const NavContext = createContext<NavContextType>({
    activeScreen: 'home',
    setActiveScreen: () => { },
    handleLanguageChange: (_: string) => { },
});