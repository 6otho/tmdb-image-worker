# TMDB Image Worker

把 TMDB 图片代理部署到你自己的 Cloudflare 账号，供 EPlayerX 或其他支持自定义 TMDB 图片地址的客户端使用。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fliixing%2Ftmdb-image-worker)
[![Test](https://github.com/liixing/tmdb-image-worker/actions/workflows/test.yml/badge.svg)](https://github.com/liixing/tmdb-image-worker/actions/workflows/test.yml)

**面向 Workers 免费套餐：每个人使用自己的账号、额度和域名。** 本项目不提供公共代理服务，也不保证任何地区一定可达或比 TMDB 原站更快。

## 快速部署

1. 点击上方 **Deploy to Cloudflare**，登录 Cloudflare 并按页面指引连接 GitHub、复制仓库。
2. 选择你的账号和 Worker 名称，然后部署。无需填写 TMDB API Key，也无需创建 KV、R2 或数据库。
3. 打开部署完成后显示的地址，例如 `https://tmdb-image-worker.<你的子域名>.workers.dev/`，应看到 `TMDB image worker OK`。
4. 访问一张示例图片，确认返回图片而不是错误页面：

   ```text
   https://你的域名/t/p/w500/1E5baAaEse26fej7uHcjOgEE2t2.jpg
   ```

这是 Cloudflare 官方部署流程，仍需你选择账号并确认部署；按钮不会替你购买付费套餐。项目无需构建；部署命令使用仓库的 `npm run deploy`。

### 绑定自己的域名

`workers.dev` 在部分网络可能无法访问。供大陆网络使用时，建议绑定自己的域名后实测。

在 Worker 的 **Settings → Domains & Routes → Add → Custom Domain** 中添加例如 `images.example.com`。域名需位于你同一 Cloudflare 账号下的有效托管区域。

如果使用 Git 或 CLI 持续部署，也将绑定写入 `wrangler.jsonc`，避免后续部署配置不一致：

```jsonc
"routes": [
  { "pattern": "images.example.com", "custom_domain": true }
]
```

把示例换成自己的域名。若不需要默认地址，可同时把 `workers_dev` 改为 `false`。

## 在 EPlayerX 中使用

在设置中找到 **TMDB → 图片地址**，推荐填写完整前缀：

```text
https://images.example.com/t/p/
```

也支持只填 `https://images.example.com`。Worker 会将 `/w500/文件名`、`/original/文件名` 等短路径直接映射到 TMDB，不增加重定向；两种路径各自缓存，请在客户端固定使用其中一种。

此项对应 `customTmdbImageUrl`。不要填到 TMDB API 地址一栏；本项目只代理图片，不能代替 API。清空图片地址可恢复客户端默认设置。已经保存的完整图片 URL 是否改用新地址，取决于客户端处理方式。

其他客户端同样将 `https://image.tmdb.org/t/p/` 替换为你的图片前缀。

## 本地部署与检查

需要 Node.js 22 或更新版本及 Git。Worker 无运行时依赖，命令会按需下载固定版本的 Wrangler。

```sh
git clone https://github.com/liixing/tmdb-image-worker.git
cd tmdb-image-worker
npm test
npx --yes wrangler@4.147.0 login
npm run deploy
```

如果你的账号已有同名 Worker，先修改 `wrangler.jsonc` 的 `name`，避免覆盖。账号和域名均由部署者选择，仓库不包含作者的账号 ID 或域名绑定。

```sh
# 只检查打包和配置，不部署
npm run check:deploy

# 对自己的线上地址检查；只填域名，不带 /t/p/
npm run smoke -- https://images.example.com
```

线上检查会访问 TMDB 原站和你的 Worker，比对图片字节，并验证缓存 HIT、HEAD、304、Range/206、query 重定向及 404。执行机器需要能访问原站；测试会产生少量真实请求。离线测试不需要账号或网络。

**请随代码一起部署 `wrangler.jsonc`，保留 `cache.enabled: true`。** 仅在控制台粘贴 JS 不会自动启用本项目依赖的 Workers Cache。缓存 HIT 和 Range 行为应在线上验证，本地测试不能证明 Cloudflare 边缘缓存正常。

## 缓存和请求处理

- 使用原生 Workers Cache 的分层缓存、请求合并和过期内容恢复机制，流式返回原始图片，不转码、不改变画质。
- 成功图片：客户端缓存 30 天、边缘新鲜期 90 天；允许过期后 1 天后台刷新、上游错误时 7 天旧图兜底。TTL 不保证图片一直驻留缓存。
- 404：边缘短缓存 60 秒、客户端不缓存；其他错误响应不存入缓存。过期旧图的实际使用仍取决于平台是否保有可用副本。
- 回源等待响应头最多 4 秒，网络异常或 502/503/504 最多重试一次；这个超时不限制收到响应头之后的图片传输时间。
- 保留 ETag、Last-Modified、Accept-Ranges，支持 HEAD、条件请求及平台对完整缓存图片的 Range 处理。
- 固定上游 `image.tmdb.org`，限制尺寸、文件名和扩展名；不接受任意目标 URL，不转发 Cookie 或 Authorization。
- query 参数通过 308 重定向移除。客户端直接使用无 query URL 可避免额外请求。
- 开启 `cross_version_cache`，更新 Worker 后复用尚有效的缓存，减少重新回源。修改响应内容、安全策略或缓存规则时，需要主动清除 Worker 缓存，或关闭此选项后部署，让新策略立即生效。`CF-Cache-Status` 由平台提供。

支持尺寸：`original`、`w45`、`w92`、`w154`、`w185`、`w300`、`w342`、`w500`、`w780`、`w1280`、`h632`。具体图片能否使用某个尺寸由 TMDB 决定；非法路径返回 404。

## 额度与费用

以下为 2026-10-02 的标准套餐信息，以 [Cloudflare 官方价格](https://developers.cloudflare.com/workers/platform/pricing/) 为准：

| 套餐 | 请求额度 | 说明 |
| --- | --- | --- |
| Workers Free | 每天 100,000 次 | 账号内共享；超限会影响服务，不是无限请求 |
| Workers Paid | 每月 $5 起，包含 1,000 万次 | 超出每百万次 $0.30；CPU 超额另计，$5 不是封顶 |

**Cloudflare 缓存命中仍占请求额度；原生缓存命中不消耗 Worker CPU。** App 本地缓存直接显示图片、没有发网络请求时，不产生 Cloudflare 请求。详见 [Workers Cache 计费](https://developers.cloudflare.com/workers/cache/#pricing)。模板不设置仅供付费套餐调整的 `limits.cpu_ms`；免费套餐由平台执行每次请求 10 ms CPU 限制，等待网络不计入 CPU 时间。付费账号部署本项目仍沿用付费账号的计费规则。

部署地址默认公开，知道地址的人可以请求允许的 TMDB 图片；CORS 不等于访问权限控制。自用时不要把个人地址当作公共图片源推广。

### 免费额度内的速度

原生 Workers Cache [对所有套餐开放](https://blog.cloudflare.com/workers-cache/)，包含分层缓存；本项目不需要付费图片转换、数据库或额外 Worker 转发。

- 缓存命中直接在边缘返回，跳过 JavaScript 和 TMDB 回源。
- 未命中时直接流式返回，收到图片数据即可向客户端传输，不等待整张图片下载完，也不解码、压缩或做像素处理。
- 同一路径固定使用合适的尺寸：小海报通常使用 `w342` 或 `w500`，避免列表全部下载 `original`。Worker 保留客户端请求的尺寸，不能替客户端决定画质。
- 客户端使用 HTTPS 和不带 query 的图片地址，保留本地缓存；不要给 URL 加随机时间戳、每次清缓存或反复测速。

这些措施降低代码开销、重复下载和回源等待，不能改变用户到 Cloudflare 的网络线路。已有线上验证使用付费账号；免费套餐兼容性依据官方功能和限制检查，尚未在独立免费账号实际部署。

## 常见问题

**为什么没有变快？**

缓存减少回源开销，无法消除用户到 Cloudflare 的线路延迟。不同地区、运营商、时段和缓存状态的结果可能不同。请在自己的网络比较同一张图片，不能只看根路径健康检查。

图片响应带有 `Server-Timing: origin_headers;dur=毫秒数`，表示 Worker 从开始回源到收到上游响应头的耗时，包含可能的重试。它不包含客户端 DNS、连接、TLS 和图片正文传输；不能拿它当完整回源下载时间。缓存命中时，此值是当初填充缓存时保存的历史值。

排查首次大图加载可结合 `curl -o /dev/null -D - -w '\nconnect=%{time_connect} tls=%{time_appconnect} first_byte=%{time_starttransfer} total=%{time_total}\n' 'https://你的域名/t/p/original/文件名.jpg'`。这些 curl 时间的单位是秒；首次请求和复测分别记录 `CF-Cache-Status`，不要仅凭一次 MISS 与一次 HIT 的总耗时就把线路波动归因于回源。

**根路径正常，图片却返回 502？**

根路径不访问 TMDB。检查 Worker 日志和图片路径；回源超时、异常重定向、非图片响应等都会返回 502。429 表示上游限流，应遵守 Retry-After，避免立即连续重试。

**出现 404？**

支持 `/t/p/尺寸/文件名` 和 `/尺寸/文件名`，路径、尺寸和扩展名需符合上面的规则；原图删除或不存在也会返回 404。不要将 API 请求发送到这里。

**如何更新或停止？**

更新自己的仓库后按原方式部署。停止使用时，先清空客户端的自定义图片地址，再在 Cloudflare 删除自己部署的 Worker。

## License

[MIT](LICENSE)。许可证适用于本仓库代码，不包含 TMDB 图片的版权授权。本项目与 TMDB、Cloudflare 无隶属关系。
