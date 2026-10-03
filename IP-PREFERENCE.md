# 为自己的网络选择图片入口 IP

如果图片已经开始返回，但大图仍很慢，可以比较自建图片域名的不同 Cloudflare 入口。选择标准是**真实图片完整下载的成功率优先，其次才是速度**。结果只代表测试时的网络；换运营商、网络或时间后需要重测。

## 1. 获取候选地址

在终端查询自己的图片域名，将下面示例域名换成实际域名：

```sh
dig +short A images.example.com
dig +short AAAA images.example.com
```

先比较这些实际解析出的地址，不需要扫描整段 Cloudflare IP。若查询结果是 `198.18.x.x` 等虚拟地址，应改用实际解析出的公网入口。IPv6 只有在当前网络支持时才单独测试。

## 2. 测试真实图片

使用 App 中几张确实存在的图片路径，包括小海报、`original` 大图和透明 PNG；根路径、Ping 和只请求响应头都不能衡量完整图片体验。同一组图片对每个候选入口测 2–3 轮，并在日常使用的网络下再检查一次。

以下命令在 macOS/Linux 终端运行。先替换域名、候选 IP 和图片路径；示例 IP 是占位值，不能直接使用：

```sh
image_host='images.example.com'
image_ip='替换成候选IP'
image_path='/t/p/original/替换成真实图片文件名.jpg'
image_test_dir=$(mktemp -d)
curl --noproxy '*' --resolve "${image_host}:443:${image_ip}" \
  --fail --show-error \
  --dump-header "$image_test_dir/headers.txt" \
  --output "$image_test_dir/image" \
  --write-out '\nstatus=%{http_code} peer=%{remote_ip} bytes=%{size_download} first_byte=%{time_starttransfer}s total=%{time_total}s speed=%{speed_download}B/s\n' \
  "https://${image_host}${image_path}"
cat "$image_test_dir/headers.txt"
```

IPv6 候选的变量写成 `image_ip='[实际IPv6地址]'`。`--resolve` 用于指定本次测速的候选地址，见 [curl 官方说明](https://everything.curl.dev/usingcurl/connections/name.html)。命令不设置整图总时限；若手动中止，应记录“中止时仍未收完”，不要算作服务器返回错误。检查 curl 退出状态、HTTP 200，并打开保存的图片确认完整。可用 `open "$image_test_dir/image"` 在 Mac 查看；测试文件保存在打印命令中的临时目录，检查后自行删除。

测速应使用实际直连网络。`--noproxy '*'` 只排除 curl 的显式代理，不能绕过 VPN 或路由器代理；需核对实际连接的远端 IP，避免测到代理线路。

比较时记录成功张数、整图耗时及 `CF-Cache-Status`。不同入口的缓存状态可能不同：首次请求单独记录，命中后再比较线路传输；不要给 URL 加随机参数，本项目会移除它们，不能借此制造冷缓存。缓存可能自行淘汰，选好后仍应看 App 的实际首次加载表现。
