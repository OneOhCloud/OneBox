import AboutItem from '../components/settings/about';
import ToggleAutoStart from '../components/settings/auto-start';
import ToggleLan from '../components/settings/lan';
import ToggleLanguage from '../components/settings/language';
import ToggleTun from '../components/settings/tun';
import UpdaterItem from '../components/settings/updater';
import { useVersion } from '../hooks/useVersion';
import { t } from '../utils/helper';



export default function Settings() {
  const version = useVersion();


  return (
    <div className="bg-gray-50 overflow-y-auto h-[calc(100vh-40px)]">
      <div className="container mx-auto p-4 max-w-md  ">
        <div className="mb-6 rounded-xl overflow-hidden bg-white shadow-none">
          <div className="divide-y divide-gray-50">
            <ToggleAutoStart />
            <ToggleLan />
            <ToggleTun />
            <ToggleLanguage />
          </div>
        </div>

        <div className="rounded-xl overflow-hidden bg-white shadow-none ">
          <div className="divide-y divide-gray-50">
            <UpdaterItem />
            <AboutItem />
          </div>
        </div>
        <div className="text-center text-[#8E8E93] text-sm mt-8">
          <p>{t("version")} {version}</p>
          <p className="mt-1">© 2025 OneOh Cloud</p>
        </div>
      </div>
    </div>
  )
}




