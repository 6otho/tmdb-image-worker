# 为自己的网络选择图片入口 IP

如果图片已经开始返回，但大图仍很慢，可以比较自建图片域名的不同 Cloudflare 入口。选择标准是**真实图片完整下载的成功率优先，其次才是速度**。这只影响使用该映射的设备；换运营商、网络或时间后需要重测，也不固定 Worker 的执行地区。

App 图片地址始终填写自己的 HTTPS 域名，例如 `https://images.example.com`，不要改成 `https://IP`。域名用于 TLS 证书校验和 Worker 路由；不需要关闭证书校验或开启 HTTPS 解密。

## 1. 获取候选地址

在终端查询自己的图片域名，将下面示例域名换成实际域名：

```sh
dig +short A images.example.com
dig +short AAAA images.example.com
```

先比较这些实际解析出的地址，不需要扫描整段 Cloudflare IP。若启用了 Surge 等软件的虚拟 DNS，可能看到 `198.18.x.x`，它不是候选公网入口；应从软件的 DNS 查询结果查看真实上游地址，或在临时关闭虚拟 DNS 后查询。IPv6 只有在当前网络支持时才单独测试。

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

IPv6 候选的变量写成 `image_ip='[实际IPv6地址]'`。`--resolve` 保留 URL 域名和 TLS 校验，只替换连接地址，见 [curl 官方说明](https://everything.curl.dev/usingcurl/connections/name.html)。命令不设置整图总时限；若手动中止，应记录“中止时仍未收完”，不要算作服务器返回错误。检查 curl 退出状态、HTTP 200，并打开保存的图片确认完整。可用 `open "$image_test_dir/image"` 在 Mac 查看；测试文件保存在打印命令中的临时目录，检查后自行删除。

注意 `--noproxy '*'` 只排除 curl 的显式代理，**不能绕过 Surge 增强模式、VPN 或路由器代理**。如果网络仍被接管，请用下面的 Surge 映射逐个测试，并在请求记录中核对真实远端 IP 和 `DIRECT`；不能只看 curl 显示的虚拟地址就认为优选生效。

比较时记录成功张数、整图耗时及 `CF-Cache-Status`。不同入口的缓存状态可能不同：首次请求单独记录，命中后再比较线路传输；不要给 URL 加随机参数，本项目会移除它们，不能借此制造冷缓存。缓存可能自行淘汰，选好后仍应看 App 的实际首次加载表现。

## 3. 在 Surge 使用选中的 IP

将条目合并到现有配置的对应段落，不要覆盖整个配置。域名换成自己的图片域名，`候选IP` 换成测试结果：

```ini
[Rule]
DOMAIN,images.example.com,DIRECT

[Host]
images.example.com = 候选IP
```

精确域名规则放在可能先匹配的代理规则和 `FINAL` 前面，Host 映射也放在可能匹配的通配符前面。规则只针对图片域名，不要将整个 Cloudflare IP 段设为直连。Surge 的映射语法及生效范围见 [官方本地 DNS 文档](https://manual.nssurge.com/dns/local-dns-mapping.html)。

保存、校验并重新加载配置后，让 App 重新建立连接；已有连接不会自动换 IP。确认 Surge 请求记录中的远端 IP 与所选地址一致，策略为 `DIRECT`，再测实际页面。Mac 的映射不会自动同步给手机或 Apple TV；其他设备必须使用自己的配置，或使用确实覆盖该设备的网关 DNS 映射。

## 4. 恢复默认与维护

变慢或连接失败时，删除 `[Host]` 中该图片域名的映射，重新加载配置并重新连接，即可恢复 DNS 自动选址。`DIRECT` 规则按自己的需要保留或删除。换网络后先恢复默认再比较，避免沿用旧网络的结果。

这是客户端可选优化，Worker 代码本身不能替用户选择接入 IP。项目不提供“永久最快 IP”，也不需要修改 Cloudflare 托管域名的 DNS 记录来给所有用户强制绑定同一个入口。
