/**
 * dsh-official-url-dump — Host half.
 *
 * 在 DeepSeek Harness 启动时取得「带 launch token 的 Web 地址」并原子写入一个文件
 *（默认 ~/.dsh/dsh-go-ssh/official-url.txt）。dsh-go 的 probe 复用守护只读这个文件，
 * 不再需要抓日志或扫描进程内存。
 *
 * 历史（为什么会改）：0.2.x 早期官方 desktop host 在 `ctx.connection` 上暴露
 * `authenticatedUrl(base)`；从 0.2.3 起该方法迁入 Token Provider 插件
 * `@deepseek-ai/dsh-host-authentication-token` 的 `BrowserAuth` 实例内部，
 * 不再挂在 `ctx.connection` 上，且 launch token 是由随机盐生成、只存在进程内的
 * WeakMap 里，无法从外部重算。因此本插件改为监听官方生成的入口 URL：
 * Token Provider 会在 `webserver/entry-url` 事件里 push 一条带 `?token=` 的入口，
 * 本插件捕获它并落盘；若旧版本仍暴露 `ctx.connection.authenticatedUrl`，作为兼容回退。
 *
 * @module dsh-official-url-dump
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = 'official-url-dump';
// webServer 用来在回退路径里读取端口/协议；entry-url 事件走 global 监听，无需依赖其 isolation。
export const inject = ['webServer'];

export function apply(ctx, config = {}) {
  const file =
    (config && typeof config.file === 'string' && config.file) ||
    path.join(os.homedir(), '.dsh', 'dsh-go-ssh', 'official-url.txt');

  let written = undefined;
  let timer;
  let tries = 0;

  const writeUrl = (url) => {
    if (!url || !String(url).includes('token=')) return false;
    const value = String(url).trim();
    // 已有相同内容就不重复落盘（避免每次 emit 都写）。
    try {
      if (fs.readFileSync(file, 'utf8').trim() === value) {
        written = value;
        return true;
      }
    } catch {}
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file); // 原子替换
      written = value;
      console.error(`[official-url-dump] wrote ${file}`);
      return true;
    } catch (e) {
      console.error(`[official-url-dump] write failed: ${e && e.message ? e.message : e}`);
      return false;
    }
  };

  // 从一次 entry-url 事件的 entries 中挑出带 token 的入口。
  const pickTokenEntry = (entries) => {
    if (!Array.isArray(entries)) return undefined;
    // 优先 label 为 'dsh web' 的入口，其次任意带 token 的。
    const web = entries.find((e) => e && /dsh web/i.test(String(e.label || '')) && String(e.url || '').includes('token='));
    if (web) return web.url;
    const any = entries.find((e) => e && String(e.url || '').includes('token='));
    return any ? any.url : undefined;
  };

  // 主路径：监听官方在启动时 spawn 的入口 URL 事件。
  // global: true 保证不受 webServer isolation 过滤影响，稳定收到。
  // 注意：本插件可能比 Token Provider 更早注册监听，emit 时其它监听器（含 Token Provider）
  // 会同步往 entries 里 push 入口。因此在当前同步栈里读到的 entries 可能是空的。
  // 把读取推迟到微任务/下一拍，等整轮 emit 的同步监听器都跑完后再从同一数组里挑。
  const off = ctx.on('webserver/entry-url', (baseUrl, entries) => {
    const pick = () => {
      const url = pickTokenEntry(entries);
      if (url) writeUrl(url);
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(pick);
    const t = setTimeout(pick, 0);
    t.unref?.();
  }, { global: true });

  // 兼容/兜底路径：旧版 host 在 ctx.connection 上有 authenticatedUrl。
  // 若存在，则轮询端口就绪后直接取 URL；新版走上面的 entry-url 事件。
  const tryLegacy = () => {
    if (written) return;
    const conn = ctx.get && ctx.get('connection');
    if (!conn || typeof conn.authenticatedUrl !== 'function') return;
    const ws = ctx.get && ctx.get('webServer');
    const port = ws && ws.port;
    if (!port) return;
    const protocol = (ws && ws.protocol) || 'http:';
    try {
      writeUrl(conn.authenticatedUrl(`${protocol}//127.0.0.1:${port}`));
    } catch (e) {
      console.error(`[official-url-dump] legacy authenticatedUrl failed: ${e && e.message ? e.message : e}`);
    }
  };
  const tickLegacy = () => {
    if (written) return;
    tryLegacy();
    if (written || tries >= 60) return;
    tries += 1;
    timer = setTimeout(tickLegacy, 1000);
    timer.unref?.();
  };
  // 仅当旧接口存在时才启动轮询，避免新版空转。
  if (ctx.get && typeof (ctx.get('connection') || {}).authenticatedUrl === 'function') {
    tickLegacy();
  }

  ctx.on?.('dispose', () => {
    if (timer) clearTimeout(timer);
    if (typeof off === 'function') off();
  });
}