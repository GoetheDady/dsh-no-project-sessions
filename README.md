# dsh-no-project-sessions

DeepSeek Harness 插件：为不属于任何项目的会话自动创建独立工作目录，并在侧栏以「最近」分区集中展示。

## 功能

- **无项目会话**：把空白会话的项目下拉菜单替换为带「不在项目中工作」选项的版本，不必先选项目或工作区。
- **自动工作目录**：发送第一条消息时，在 `~/Documents/dsh/<YYYY-MM-DD>/` 下根据消息内容创建可读的目录名；重名时自动追加 `-2`、`-3` 等后缀。
- **侧栏「最近」分区**：使用 Harness 原生 workspace 分组展示这些会话，并将组头样式调整为与「工作区」同级的分区标题。
- **无侵入**：复用 Harness 的 workspace、session、slot 与主题 token，不替换宿主组件，也不改写其它插件的 DOM。

## 环境

- DeepSeek Harness 0.2.x（Desktop / Web）
- 插件同时包含 Host 与 Client 两半：
  - Host：注册 `POST /dsh-no-project/prepare`，原子地预留目录并提交会话工作目录。
  - Client：替换项目下拉菜单（加入「不在项目中工作」）并提供「最近」分区标题样式。

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

## 验证

插件装好之后怎么确认它真的在跑、页面在哪看、哪些东西验证不了，见 [docs/verification.md](docs/verification.md)。要点：

- 三层通道：安装返回值 → Host inspect → Client inspect（会转发进真实页面作答）。
- 用能力证明，不用截图证明：路由的 `401` / `405`、Slot occupant 的 `active` 才是证据。
- `Config.listConfigs` 的 `status` **不是**活性；没有已认证标签页时，报告里必须写清「视觉未验证」。

## 目录

```text
lib/index.js        Host half：workspace 注册、目录预留、上传路由
lib/client.js       Client half：项目下拉增强、侧栏「最近」样式
locale/*.json       插件标题与描述
cordis.patch.yml    Bundle 入口
tests/              Node 内置测试
docs/               验证方法与实测记录
```
