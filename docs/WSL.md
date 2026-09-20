# WSL

内置 `envoi.wsl` 插件通过 Windows 的 `wsl.exe` 直接打开已安装发行版中的目录，无需配置 SSH 服务。

## 使用

1. 打开「设置 → 扩展 → WSL」，或项目菜单中的「WSL」。
2. 选择已安装的发行版，自动定位到默认用户的 home。输入路径会显示真实目录建议，点击建议继续浏览，也支持 `~/`。选择目录后点击「连接并打开」。
3. 在首次运行语言服务、Git、编译或终端前确认项目信任。

本机需要 Windows 和可用的 WSL。首次连接自动下载官方 Node.js 22.23.2 Linux 运行时，按固定 SHA256 校验，在默认用户的 `~/.envoi/runtimes` 下安装并复用。支持 x64 和 arm64，不需要 sudo，不修改系统 Node.js、PATH 配置或 shell 启动文件。安装失败时显示错误，可重新连接重试；目录浏览不依赖 Node.js。终端另需 Python 3。语言服务器、Git 和编译器也需要在该发行版中安装。插件不自动安装发行版，不更改默认发行版或默认用户。

文件树、编辑保存、资源预览、LSP、格式化、Git、编译与终端复用远程工作区能力。断线时保留本地草稿，支持重新连接；发行版停止后不保证远端进程恢复。不同发行版、目录和 SSH 连接使用独立身份。

连接时将随应用构建的服务上传到发行版用户的 `~/.envoi/remote-server`，校验 SHA256 后启动。协议通过标准输入输出传输，不监听额外网络端口。服务沿用 Remote SSH 的路径限制、项目信任和会话生命周期。首次连接采用发行版默认用户。

论文库支持在线搜索、浏览下载、导入 PDF/BibTeX、阅读笔记和引用；文件与数据库保存在当前 WSL 项目内。网络请求和导出对话框在桌面端运行，远程 Git worktree 的资料库独立存储，不跨越当前项目边界。AI、实验工作区、外部拖放和应用内工具安装尚未接入，远程编辑器隐藏不可用的 AI 输入区。

首次运行时安装需要发行版提供 `tar`、`xz` 和 `coreutils`。缺失时会在下载前列出依赖和安装指引；Fedora 可运行 `sudo dnf install tar xz coreutils`，Debian/Ubuntu 可运行 `sudo apt-get install tar xz-utils coreutils`。打开连接窗口不会自动启动列表中的首个发行版；从状态栏打开会保留当前连接的发行版和目录。

## 验证

`npm run ci:check` 包含发行版输出解码、参数验证、身份隔离、工作区协议与桌面入口检查。

真实 WSL 测试：预先在指定发行版安装 Python 3 和 Git，然后设置 `ENVOI_TEST_WSL_DISTRO` 并运行 `npm --prefix app run test:wsl`。测试在发行版临时目录中验证 home 与目录补全、自动运行时准备、文件、信任、Git、终端和重连，退出时清理测试目录。安装 clangd 后可同时设置 `ENVOI_TEST_WSL_LSP=1`，验证诊断与定义跳转。

命令接口参考：[Microsoft WSL 基本命令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)。
