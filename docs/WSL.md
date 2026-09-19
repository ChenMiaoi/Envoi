# WSL

内置 `envoi.wsl` 插件通过 Windows 的 `wsl.exe` 直接打开已安装发行版中的目录，无需配置 SSH 服务。

## 使用

1. 打开「设置 → 扩展 → WSL」，或项目菜单中的「WSL」。
2. 选择已安装的发行版，输入 Linux 绝对目录，点击「连接并打开」。
3. 在首次运行语言服务、Git、编译或终端前确认项目信任。

本机需要 Windows 和可用的 WSL。发行版默认用户的 PATH 中需要 Linux Node.js 22+；终端另需 Python 3。语言服务器、Git 和编译器也需要在该发行版中安装。插件不自动安装发行版或运行时，不更改默认发行版或默认用户。

文件树、编辑保存、资源预览、LSP、格式化、Git、编译与终端复用远程工作区能力。断线时保留本地草稿，支持重新连接；发行版停止后不保证远端进程恢复。不同发行版、目录和 SSH 连接使用独立身份。

连接时将随应用构建的服务上传到发行版用户的 `~/.envoi/remote-server`，校验 SHA256 后启动。协议通过标准输入输出传输，不监听额外网络端口。服务沿用 Remote SSH 的路径限制、项目信任和会话生命周期。首次连接采用发行版默认用户。

当前功能边界及文件规模限制与 [Remote SSH](REMOTE_SSH.md) 相同：AI、研究资料库、实验工作区、外部导入和应用内工具安装尚未接入。

## 验证

`npm run ci:check` 包含发行版输出解码、参数验证、身份隔离、工作区协议与桌面入口检查。

真实 WSL 测试：预先在指定发行版安装 Node.js 22+ 和 Python 3，然后设置 `ENVOI_TEST_WSL_DISTRO` 并运行 `npm --prefix app run test:wsl`。测试在发行版临时目录中验证文件、信任、Git、终端和重连，退出时清理测试目录。安装 clangd 后可同时设置 `ENVOI_TEST_WSL_LSP=1`，验证诊断与定义跳转。

命令接口参考：[Microsoft WSL 基本命令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)。
