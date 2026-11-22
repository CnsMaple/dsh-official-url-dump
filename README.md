# dsh-official-url-dump

把官方 **DeepSeek Harness 桌面版** 的「带 launch token 的 Web 地址」原子写入一个文件，供 [`dsh-go`](https://github.com/ccch1mneyyy/dsh-go) 的 SSH probe 复用读取。

> 不再需要抓日志或扫描进程内存。

## 背景

官方 DeepSeek Harness 桌面版的 Web 服务使用随机端口（`--port 0`），且 `?token=` 是每个进程随机生成、只存在内存里的 launch token。`dsh-go` 走 SSH 复用这个 Web 实例时，需要拿到当前真实可用的 `http://127.0.0.1:<port>/?token=<token>`。

本插件在桌面端启动时，使用和官方 host 相同的内部方法取得该 URL，并写到：

```text
$HOME/.dsh/dsh-go-ssh/official-url.txt
```

## 工作原理

桌面 host 自身通过 `ctx.connection.authenticatedUrl(...)` 生成带 token 的地址。本插件：

```js
export const name = 'official-url-dump'
export const inject = ['connection', 'webServer']
```

在 `apply(ctx)` 中读取 `ctx.webServer.port` 与 `ctx.webServer.protocol`，调用：

```js
ctx.connection.authenticatedUrl(`${protocol}//127.0.0.1:${port}`)
```

拿到结果后先写临时文件，再 `rename` 原子替换目标文件。若 webServer 尚未 listen，则每 1 秒重试，最多 60 次。

## 安装

### 1. 放入 profile 插件目录

```text
<DSH_HOME>/profiles/desktop/plugins/dsh-official-url-dump/
```

### 2. 在 profile 的 `package.json` 中注册

`profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "dsh-official-url-dump": "file:plugins/dsh-official-url-dump"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-official-url-dump"
      ]
    }
  }
}
```

### 3. 用 `cordis.patch.yml` 挂载

`profiles/desktop/cordis.patch.yml`：

```yaml
- insert:
    - id: official-url-dump
      name: dsh-official-url-dump
```

然后重启 DeepSeek Harness 桌面端（或重新加载 profile）。

## 配置

可选配置项：

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
http://127.0.0.1:1203/?token=wTNo7GOS6IHN344i5SkelN8TvF4VysC6T2JkZ423lWE
```

文件权限使用 `0o600` 写入（Windows 上 chmod 语义有限，但尽量收窄）。目标目录自动创建。

## 安全说明

- 输出文件里是**有效的 Web 访问 token**，等同登录凭证，请勿公开、提交到仓库或发给他人。
- 本插件只把 URL 写到本机文件，不发网络请求、不向外传输。
- 使用的是官方桌面端的内部 API（`ctx.connection.authenticatedUrl`），官方升级后接口可能变化；若失效，请检查对应版本源码。

## License

MIT
