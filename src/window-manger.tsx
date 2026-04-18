import { useEffect, useState } from 'react';
import App from './App';
import { useTheme } from './hooks/useTheme';
import LogPage from './page/log';



export default function WindowManger() {
  // Mount once per window so BOTH the main app and the log window apply
  // the persisted theme on boot and react to cross-window toggle events.
  // Each Tauri window has its own `document.documentElement`; relying on
  // only App.tsx would leave the log window stuck on the default theme.
  useTheme();

  const [windowType, setWindowType] = useState<string>('loading');


  useEffect(() => {
    const getWindowType = async () => {
      const query = new URLSearchParams(window.location.search);
      const tag = query.get('windowTag');
      if (tag) {
        setWindowType(tag);
      } else {
        console.warn('No windowTag found in URL, defaulting to main window');
        setWindowType('main');
      }
    };
    getWindowType();
  }, []);

  if (windowType === 'main') {
    return <App />;
  }
  if (windowType === 'sing-box-log') {
    return <LogPage />;
  }
  return <div></div>

}