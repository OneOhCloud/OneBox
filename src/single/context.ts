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
    // Whether the apply pipeline should auto-start the VPN engine after
    // import. True = deep-link apply=1 behaviour (the default). Set to
    // false right before firing `setDeepLinkApplyUrl` to request a
    // manual-add flow: import only, no engine restart, no SSI auto-select.
    // The consumer (useVPNOperations) resets this back to true after
    // consuming each URL, so every fresh fire defaults to the apply=1
    // contract unless explicitly overridden.
    deepLinkApplyAutoStart: boolean;
    setDeepLinkApplyAutoStart: (autoStart: boolean) => void;
}

export const NavContext = createContext<NavContextType>({
    activeScreen: 'home',
    setActiveScreen: () => { },
    handleLanguageChange: (_: string) => { },
    deepLinkUrl: '',
    setDeepLinkUrl: () => { },
    deepLinkApplyUrl: '',
    setDeepLinkApplyUrl: () => { },
    deepLinkApplyAutoStart: true,
    setDeepLinkApplyAutoStart: () => { },
});