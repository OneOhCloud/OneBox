import { useEffect, useState } from 'react';
import App from './App';
import LogPage from './page/log-page';



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


  return (

    <div className='rounded-xl '>

      <div style={{ display: windowType === 'main' ? 'block' : 'none' }}>
        <App />
      </div>
      <div style={{ display: windowType === 'sing-box-log' ? 'block' : 'none' }}>
        <LogPage />
      </div>
    </div>
  )

}