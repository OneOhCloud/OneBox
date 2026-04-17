import AboutItem from '../components/settings/about';
import ToggleAutoStart from '../components/settings/auto-start';
import ToggleLan from '../components/settings/lan';
import ToggleLanguage from '../components/settings/language';
import RouterSettingsItem from '../components/settings/router-settings';
import ToggleTun from '../components/settings/tun';
import UpdaterItem from '../components/settings/updater';
import { useVersion } from '../hooks/useVersion';
import { t } from '../utils/helper';

export default function Settings() {
  const version = useVersion();

  return (
    <div className="onebox-scrollpage">
      <div className="onebox-page-inner">
        <div className="onebox-grouped-card mb-5">
          <ToggleAutoStart />
          <ToggleLan />
          <ToggleTun />
          <ToggleLanguage />
        </div>

        <div className="onebox-grouped-card">
          <RouterSettingsItem />
          <UpdaterItem />
          <AboutItem />
        </div>

        <div className="text-center text-[11px] mt-6 mb-2" style={{ color: 'var(--onebox-label-tertiary)' }}>
          <p>{t("version")} {version}</p>
          <p className="mt-0.5">© 2025 OneOh Cloud</p>
        </div>
      </div>
    </div>
  );
}
