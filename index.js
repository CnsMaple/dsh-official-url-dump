/**
 * dsh-official-url-dump — Host half.
 *
 * 在官方 DeepSeek Harness 桌面版启动时，取得「带 launch token 的 Web 地址」并原子写入一个
 * 文件（默认 ~/.dsh/dsh-go-ssh/official-url.txt）。dsh-go 的 probe 复用守护只读这个文件，
 * 不再需要抓日志或扫描进程内存。
 *
 * 原理：桌面 host 自己就是用 ctx.connection.authenticatedUrl(`${protocol}//127.0.0.1:${port}`)
 * 拿到带 ?token= 的地址（见 dsh-desktop-host/lib/index.js）。本插件 inject 同一批服务，调同一
 * 方法，把结果落盘。
 *
 * @module dsh-official-url-dump
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = 'official-url-dump';
export const inject = ['connection', 'webServer'];

export function apply(ctx, config = {}) {
  const file =
    (config && typeof config.file === 'string' && config.file) ||
    path.join(os.homedir(), '.dsh', 'dsh-go-ssh', 'official-url.txt');

  let done = false;
  let tries = 0;
  let timer;

  const writeOnce = () => {
    tries += 1;
    try {
      const port = ctx.webServer && ctx.webServer.port;
      const protocol = (ctx.webServer && ctx.webServer.protocol) || 'http:';
      if (!port) return false; // 还没 listen，稍后重试
      const base = `${protocol}//127.0.0.1:${port}`;
      const url = ctx.connection.authenticatedUrl(base);
      if (!url || !String(url).includes('token=')) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${url}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file); // 原子替换
      done = true;
      console.error(`[official-url-dump] wrote ${file}`);
      return true;
    } catch (e) {
      console.error(`[official-url-dump] ${e && e.message ? e.message : e}`);
      return false;
    }
  };

  // 启动即试；webServer 可能尚未 listen，失败就每 1s 重试，最多 60 次。
  const tick = () => {
    if (writeOnce()) return;
    if (tries >= 60) {
      console.error('[official-url-dump] gave up after 60 tries');
      return;
    }
    timer = setTimeout(tick, 1000);
    timer.unref?.();
  };
  tick();

  // 若插件被重载/卸载，清理定时器。
  ctx.on?.('dispose', () => {
    if (timer) clearTimeout(timer);
  });
}
