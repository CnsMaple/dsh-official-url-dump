# dsh-official-url-dump

把官方 **DeepSeek Harness**（桌面版 / Web 版）的「带 launch token 的 Web 地址」原子写入一个文件，供 [`dsh-go`](https://github.com/ccch1mneyyy/dsh-go) 的 SSH probe 复用读取。

> 不再需要抓日志或扫描进程内存。

## 背景

官方 DeepSeek Harness 的 Web 服务使用随机端口（`--port 0`），且 `?token=` 是每个进程随机生成、只存在进程内存（一个 `WeakMap`）里的 launch token。`dsh-go` 走 SSH 复用这个 Web 实例时，需要拿到当前真实可用的 `http://127.0.0.1:<port>/?token=<token>`。

本插件在 Host 启动时，从官方生成的「入口 URL」里取到该地址，写到：

```text
$HOME/.dsh/dsh-go-ssh/official-url.txt
```

## 工作原理

**0.2.3 起（当前实现）**：Token Provider 插件 `@deepseek-ai/dsh-host-authentication-token` 在 Web App 启动时会触发 `webserver/entry-url` 事件，并往 `entries` 里 push 一条 `{ label: 'dsh web', url: '<带 ?token=>' }` 的入口。本插件以 `{ global: true }` 监听该事件，挑出带 `token=` 的入口并落盘：

```js
export const name = 'official-url-dump'
export const inject = ['webServer']

ctx.on('webserver/entry-url', (baseUrl, entries) => {
  const url = pickTokenEntry(entries) // 优先 label 匹配 /dsh web/i 且含 token=
  if (url) writeUrl(url)
}, { global: true })
```

为什么不再用 `ctx.connection.authenticatedUrl`：从 0.2.3 起该方法从 `ctx.connection` 迁入了 Token Provider 内部的 `BrowserAuth` 实例，且 launch token 是随机盐、只在进程内存的 `WeakMap` 里，外部无法重算。因此改成「捕获官方自己生成的入口 URL」。

> 实现细节：本插件可能比 Token Provider 更早注册监听，同步 emit 期间读到的 `entries` 可能为空，故把读取推迟到微任务/下一拍，等所有监听器 push 完再挑带 `token=` 的入口。

**兼容回退**：若某些旧版本的 Host 仍在 `ctx.connection` 上暴露 `authenticatedUrl`，插件会检测到并每秒轮询、最多 60 次，直接取 URL 落盘（只用在新接口缺位时）。

写入采用「临时文件 + `rename` 原子替换」，内容与已存在文件相同则跳过，权限 `0o600`。

## 安装

### 方式 A：从 Git 仓库安装（推荐）

```bash
dsh plugin add github:CnsMaple/dsh-official-url-dump
```

> 桌面版 profile 由 Electron 托管，命令行可能报 `profile "desktop" is managed exclusively by the Electron application`；此时改用图形界面（插件市场 / 从 Git 安装），或安装进 `web` profile。

### 方式 B：放入 profile 插件目录

1. 放入 `<DSH_HOME>/profiles/<profile>/plugins/dsh-official-url-dump/`
2. 在 profile 的 `package.json` 注册依赖：`"dsh-official-url-dump": "file:plugins/dsh-official-url-dump"`
3. 用 `cordis.patch.yml` 挂载（见下）
4. 重启 DeepSeek Harness 或重新加载 profile

## 配置

```yaml
- insert:
    - id: official-url-dump
      name: dsh-official-url-dump
      config:
        file: "C:/Users/you/.dsh/dsh-go-ssh/official-url.txt"
```

不配置时默认写入 `<用户主目录>/.dsh/dsh-go-ssh/official-url.txt`，不硬编码用户名，便于换机复用。

## 输出示例

```text
http://127.0.0.1:3080/?token=wTNo7GOS6IHN344i5SkelN8TvF4VysC6T2JkZ423lWE
```

## 安全说明

- 输出文件里是**有效的 Web 访问 token**，等同登录凭证，请勿公开、提交到仓库或发给他人。
- 本插件只把 URL 写到本机文件，不发网络请求、不向外传输。
- 依赖官方内部事件 `webserver/entry-url`；官方升级后接口若变化，请对照对应版本源码调整。

## License

MIT