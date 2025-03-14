import { useState } from 'react';
import {
  BellFill,
  BrushFill,
  ChevronRight,
  CloudFill,
  DisplayFill,
  GearFill,
  Globe,
  InfoCircleFill,
  ShieldLockFill
} from 'react-bootstrap-icons';

const aboutText = `Copyright 2025 OneOh Cloud Company <support@oneoh.cloud>
Registration Address: 7001, 1021 E Lincolnway, Cheyenne, WY, Laramie, US, 82001

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

Additional Terms:
1. Without the explicit written permission of OneOh Cloud Company, you may not use the name, 
   trademark, logo, or other brand features of "OneOh Cloud", or suggest association with 
   OneOh Cloud Company or this software.
2. Without prior consent, any derivative works may not use the name of the program or suggest 
   association with the program.
3. The above copyright notice and these license terms must be retained in all copies and 
   derivative works.
4. OneOh Cloud Company expressly opposes the use or distribution of this software by users or 
   distributors in a manner that violates US law or Wyoming state law. Any such action is the 
   sole responsibility of the respective user or distributor, and OneOh Cloud Company reserves 
   the right to pursue related liabilities to the extent permitted by law.
5. The interpretation and enforcement of this license are governed by US law and Wyoming state law. 
   In the event of a conflict with the laws of other jurisdictions, US law and Wyoming state law 
   shall prevail.

---------- 中文译本（仅供参考，以英文为准）----------

版权所有 2025 OneOh Cloud 公司 <support@oneoh.cloud>
注册地址：7001, 1021 E Lincolnway, Cheyenne, WY, Laramie, US, 82001

根据 Apache 许可证 2.0 版（"许可证"）获得许可；
除非遵守许可证，否则您不得使用此文件。
您可以在以下位置获取许可证副本：

    http://www.apache.org/licenses/LICENSE-2.0

除非适用法律要求或书面同意，否则根据许可证分发的软件是
基于"按原样"分发的，没有任何明示或暗示的保证或条件。
有关许可证下特定语言的权限和限制，请参阅许可证。

附加条款：
1. 未经 OneOh Cloud 公司明确书面许可，不得使用"OneOh Cloud"名称、商标、标志或其他品牌特征，或暗示与 OneOh Cloud 公司或本软件有关联。
2. 未经事先同意，任何衍生作品不得使用该程序的名称或暗示与该程序有关联。
3. 必须在所有副本和衍生作品中保留上述版权声明和本许可条款。
4. OneOh Cloud公司明确反对使用者或分发者以违反美国法律或怀俄明州法律的方式使用或分发本软件。任何此类行为均由相关使用者或分发者自行承担责任，OneOh Cloud公司保留在法律允许范围内追究相关责任的权利。
5. 本许可的解释和执行受美国法律及怀俄明州法律管辖。若与其他司法管辖区的法律发生冲突，则以美国法律及怀俄明州法律为准。`;

export default function Settings() {
  const [lanEnabled, setLanEnabled] = useState(false);

  return (
    <div className="bg-gray-50 min-h-screen pt-4 ">

      <div className="container mx-auto px-4 max-w-md">
        {/* 常规设置组 */}
        <div className="mb-6 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="divide-y divide-gray-100">
            <ToggleSetting
              icon={<Globe className="text-[#007AFF]" size={22} />}
              title="允许局域网连接"
              subTitle="127.0.0.1:6789"
              isEnabled={lanEnabled}
              onToggle={() => setLanEnabled(!lanEnabled)}
            />
            <SettingItem
              icon={<BellFill className="text-[#FF3B30]" size={22} />}
              title="通知"
            />
            <SettingItem
              icon={<DisplayFill className="text-[#5856D6]" size={22} />}
              title="显示与亮度"
            />
            <SettingItem
              icon={<ShieldLockFill className="text-[#34C759]" size={22} />}
              title="隐私与安全"
            />
          </div>
        </div>

        {/* 高级设置组 */}
        <div className="mb-6 rounded-xl overflow-hidden bg-white shadow-sm">
          <div className="divide-y divide-gray-100">
            <SettingItem
              icon={<GearFill className="text-[#8E8E93]" size={22} />}
              title="高级选项"
            />
            <SettingItem
              icon={<CloudFill className="text-[#007AFF]" size={22} />}
              title="备份与恢复"
            />
            <SettingItem
              icon={<BrushFill className="text-[#FF9500]" size={22} />}
              title="主题与外观"
            />
          </div>
        </div>

        {/* 关于部分 */}
        <div className="rounded-xl overflow-hidden bg-white shadow-sm mb-6">
          <div className="divide-y">
            <SettingItem
              icon={<InfoCircleFill className="text-[#007AFF]" size={22} />}
              title="关于"
              badge="新版本"
              onPress={() => alert(aboutText)}
            />
          </div>
        </div>

        {/* 版本信息 */}
        <div className="text-center text-[#8E8E93] text-sm mt-6">
          <p>版本 1.0.0</p>
          <p className="mt-1">© 2024 OneOh Cloud</p>
        </div>
      </div>
    </div>
  )
}

// 设置项组件
function SettingItem({
  icon,
  title,
  badge,
  onPress = () => { }
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  onPress?: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between p-4 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors"
      onClick={onPress}
    >
      <div className="flex items-center">
        <div className="mr-4">{icon}</div>
        <span className="text-[#1C1C1E]">{title}</span>
      </div>
      <div className="flex items-center">
        {badge && (
          <span className="badge badge-sm bg-[#FF3B30] border-[#FF3B30] text-white mr-2">{badge}</span>
        )}
        <ChevronRight className="text-[#C7C7CC]" size={16} />
      </div>
    </div>
  );
}

// 带开关的设置项组件
function ToggleSetting({
  icon,
  title,
  subTitle,
  isEnabled,
  onToggle
}: {
  icon: React.ReactNode;
  title: string;
  subTitle?: string;
  isEnabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-4  hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors">
      <div className="flex items-center">
        <div className="mr-4">{icon}</div>
        <div>
          <div className="text-[#1C1C1E]">{title}</div>
          {subTitle && <div className="text-xs text-[#8E8E93]">{subTitle}</div>}
        </div>
      </div>
      <input
        type="checkbox"
        className="toggle bg-[#E9E9EB] border-[#E9E9EB] checked:text-white checked:bg-[#34C759] checked:border-[#34C759]"
        checked={isEnabled}
        onChange={onToggle}
      />
    </div>
  );
}