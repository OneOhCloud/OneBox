import AboutItem from '../components/settings/about';
import ToggleAutoStart from '../components/settings/auto-start';
import ToggleLan from '../components/settings/lan';
import ToggleTun from '../components/settings/tun';
import UpdaterItem from '../components/settings/updater';
import { useVersion } from '../hooks/useVersion';

export default function Settings() {
  const version = useVersion();

  return (
    <div className="bg-gray-50 h-full pt-4 ">
      <div className="container mx-auto px-4 max-w-md">
        <div className="mb-6 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="divide-y divide-gray-100">
            <ToggleAutoStart />
            <ToggleLan />
            <ToggleTun />
          </div>
        </div>

        <div className="rounded-xl overflow-hidden bg-white shadow-sm mb-6">
          <div className="divide-y divide-gray-100">
            <UpdaterItem />
            <AboutItem />
          </div>
        </div>
        <div className="text-center text-[#8E8E93] text-sm mt-6">
          <p>版本 {version}</p>
          <p className="mt-1">© 2024 OneOh Cloud</p>
        </div>
      </div>
    </div>
  )
}




