# Changelog

## [Changes since v1.1.47]

### ⚠ CHANGES
- The application checks network status on startup.
- Added a suggestion to restart the computer when adding a configuration file fails.

### 🔨 Performance
- ping_captive adds a check for 223.5.5.5 port 853 to quickly detect network status. If the check fails, the original logic is executed.


## [自 v1.1.47 以来的变更]

### ⚠ 变更
- 应用程序启动时检测网络状态。
- 在添加配置文件失败时的提示内容增加：尝试重启电脑的建议。

### 🔨 性能优化
- ping_captive 增加对 223.5.5.5 853 端口的检测，用于快速检测网络状态，若检测失败则执行原有逻辑。