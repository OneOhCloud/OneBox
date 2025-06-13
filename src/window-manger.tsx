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
        setWindowType('main');
      }
    };
    getWindowType();
  }, []);


  return (

    <div className='rounded-xl '>

      {windowType === 'main' && (
        <App></App>
      )}

      {windowType === 'sing-box-log' && (
        <LogPage></LogPage>
      )}
    </div>
  )

}