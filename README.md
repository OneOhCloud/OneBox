# 项目状态 / Project Status 🚧

此项目处于内部开发阶段，Git 记录可能会被清空或强制覆盖。请不要克隆本项目或者将其用于生产环境。⚠️

This project is currently under internal development, and git history may be cleared or forcibly overwritten at any time. Please do not clone this project or use it in a production environment. ⚠️


# 启动流程

点击启动
1. 读选中的配置文件
2. 读 tun 和 allow lan 设置
3. 若无tun，找到并去掉配置中的 tun inbound
4. 若无 allow lan ，将 inbound 监听地址设置为 127.0.0.1 端口强制使用 5678
5. 启用clash api 合并配置文件写入到指定目录
6. 启动核心

