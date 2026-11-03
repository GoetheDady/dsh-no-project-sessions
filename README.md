# dsh-no-project-sessions

DeepSeek Harness 插件：为不属于任何项目的会话自动创建独立工作目录，并在侧栏以「最近」分区集中展示。

## 功能

- **无项目会话**：在空白的新会话上提供「无项目」入口，不需要先选择项目或工作区。
- **自动工作目录**：发送第一条消息时，在 `~/Documents/dsh/<YYYY-MM-DD>/` 下根据消息内容创建可读的目录名；重名时自动追加 `-2`、`-3` 等后缀。
- **侧栏「最近」分区**：使用 Harness 原生 workspace 分组展示这些会话，并将组头样式调整为与「工作区」同级的分区标题。
- **工作目录状态**：会话头部显示当前工作目录，并可直接在文件管理器中打开。
- **无侵入**：复用 Harness 的 workspace、session、slot 与主题 token，不替换宿主组件，也不改写其它插件的 DOM。

## 环境

- DeepSeek Harness 0.2.x（Desktop / Web）
- 插件同时包含 Host 与 Client 两半：
  - Host：注册 `POST /dsh-no-project/prepare`，原子地预留目录并提交会话工作目录。
  - Client：提供「无项目」入口、工作目录展示和「最近」分区标题样式。

## 安装

将本仓库克隆到本地：

```bash
git clone git@github.com:GoetheDady/dsh-no-project-sessions.git
```

然后在 DeepSeek Harness 的插件管理器中安装这个本地包目录（包含 `package.json` 与 `cordis.patch.yml`），或在 profile 的 `dsh.profile.bundles` 中引用它。

插件会把 `<home>/Documents/dsh` 作为无项目会话的草稿根目录，首次启动时自动创建。

## 开发

```bash
npm test
node --check lib/client.js
node --check lib/index.js
```

## 目录

```text
lib/index.js        Host half：workspace 注册、目录预留、上传路由
lib/client.js       Client half：会话入口、工作目录 chip、侧栏「最近」样式
locale/*.json       插件标题与描述
cordis.patch.yml    Bundle 入口
tests/              Node 内置测试
```
