import { useEffect, useState } from 'react';
import App from './App';
import LogPage from './page/log';



export default function WindowManger() {

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