import { createContext } from "react";



export type ActiveScreenType = 'home' | 'configuration' | 'settings' | 'developer_options' | 'router_settings';



interface NavContextType {
    activeScreen: ActiveScreenType;
    setActiveScreen: (screen: ActiveScreenType) => void;
    handleLanguageChange: (lang: string) => void;
    deepLinkUrl: string;
    setDeepLinkUrl: (url: string) => void;
    deepLinkApplyUrl: string;
    setDeepLinkApplyUrl: (url: string) => void;
}

export const NavContext = createContext<NavContextType>({
    activeScreen: 'home',
    setActiveScreen: () => { },
    handleLanguageChange: (_: string) => { },
    deepLinkUrl: '',
    setDeepLinkUrl: () => { },
    deepLinkApplyUrl: '',
    setDeepLinkApplyUrl: () => { },
});