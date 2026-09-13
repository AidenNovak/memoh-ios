# 联调环境

这个项目的开发环境分两层：**App 跑在本机模拟器上**，**Memoh 服务端跑在 vultr-sg 上**。
两者之间用一条 SSH 隧道连接。

## 为什么这样分

- 本机（Mac mini / MacBook）只跑 Xcode 与模拟器。iOS 构建本身就已经很吃资源了，
  再叠一个 Go 服务端 + PostgreSQL + 容器运行时没有意义。
- vultr-sg 上有 Memoh 的容器运行时需要的条件（containerd、CNI、cgroup v2），
  而这些在 macOS 上要么没有、要么要靠 Docker Desktop 虚拟机绕一大圈。
- 更重要的是：**给 agent 用的开发环境必须是可复现的**。写在服务器上的脚本能被
  任何人（或任何 agent）重新跑一遍得到同样的环境；写在某台 Mac 上的不行。

## 拓扑

```
┌───────────────────────────┐         ┌────────────────────────────────────────┐
│ 本机（macOS）              │         │ vultr-sg（Linux, 31 GiB）              │
│                            │         │                                        │
│  iOS Simulator             │         │  /opt/memoh-dev/                       │
│      │                     │         │    ├── src/          我们的 fork 检出   │
│      │ http://127.0.0.1    │  SSH    │    ├── config.toml   （600，含密钥）    │
│      ▼                     │ 隧道    │    ├── secrets/      （700）           │
│  ssh -L 18080 / 18082  ────┼────────▶│    ├── ops/          运维脚本           │
│                            │         │    └── docker-compose.override.yml     │
└───────────────────────────┘         │                                        │
                                      │  memoh-dev compose project             │
                                      │   server  127.0.0.1:18080              │
                                      │   web     127.0.0.1:18082              │
                                      │   postgres / pgvector / channel         │
                                      │                                        │
                                      │  ⚠️ 与同机生产 meimaobing-alpha 完全隔离 │
                                      └────────────────────────────────────────┘
```

**隔离措施**（这台机器同时跑着生产「没猫饼」）：

| 手段 | 说明 |
|---|---|
| 端口只绑 127.0.0.1 | `docker-compose.override.yml` 里覆盖了 `ports`，公网不可达 |
| 资源上限 | server 3 CPU / 3 GiB，postgres 1 GiB，其余更小 |
| 独立 compose project | `memoh-dev`，与 `meimaobing-alpha` 的容器/网络/卷完全分开 |
| 独立目录 | `/opt/memoh-dev`，不碰 `/opt/meimaobing-alpha` |

## 一次性准备

### 1. 在 vultr-sg 上起 Memoh

```bash
# 从仓库里推上去（首次或脚本有更新时）
scp infra/vultr-sg/*.sh infra/vultr-sg/*.py vultr-sg:/opt/memoh-dev/ops/
ssh vultr-sg "chmod +x /opt/memoh-dev/ops/*.sh"

# 拉代码 + 生成配置与密钥（幂等）
ssh vultr-sg "bash /opt/memoh-dev/ops/bootstrap.sh"

# 起服务
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh up"
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh health"
```

### 2. 准备一个能对话的 bot

服务端起得来不等于能对话：还需要一个模型提供商、一个导入并**启用**的模型、
一个 bot，以及把模型设成 bot 的默认对话模型。

```bash
# provider 的 API key 只存在服务器上，不进仓库、不打印
ssh vultr-sg "cat > /opt/memoh-dev/secrets/provider.env <<'EOF'
MEMOH_DEV_PROVIDER_TEMPLATE=deepseek
MEMOH_DEV_PROVIDER_API_KEY=<在这里填 key>
EOF
chmod 600 /opt/memoh-dev/secrets/provider.env"

ssh vultr-sg "bash /opt/memoh-dev/ops/seed-dev-bot.sh"
```

脚本是幂等的。注意两个容易踩的点，脚本里已经处理：
- 导入的模型默认 **disabled**，要显式启用，否则 run 在解析阶段就失败；
- 对话模型是写在 **bot settings** 里的（`PUT /bots/{id}/settings`），不是 bot 记录上。

### 3. 本机开隧道

```bash
pnpm dev:env          # 建立 18080 / 18082 隧道
pnpm dev:env:stop     # 关掉
```

隧道建立后：

- API `http://127.0.0.1:18080`
- Web UI `http://127.0.0.1:18082`（可以直接在浏览器里对照官方前端的行为）

App 的登录页默认填的就是 `http://127.0.0.1:18080`。

## 凭据放在哪

| 位置 | 内容 | 权限 |
|---|---|---|
| `vultr-sg:/opt/memoh-dev/secrets/memoh-dev.env` | 数据库密码、JWT secret、admin 密码 | 600 |
| `vultr-sg:/opt/memoh-dev/secrets/provider.env` | 模型提供商的 API key | 600 |
| `vultr-sg:/opt/memoh-dev/config.toml` | 服务端配置（含上面几个 secret） | 600 |
| 本机 `~/.config/memoh-ios/dev.env` | 上面第一份的副本，供本机脚本读 | 600 |

**这些文件都不进 Git。** 仓库里的脚本只负责读写它们，从不打印内容。

## 常用运维

```bash
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh ps"          # 容器状态
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh health"      # 健康检查 + 资源占用
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh logs server" # 服务端日志
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh pull"        # 拉新镜像并重启
ssh vultr-sg "/opt/memoh-dev/ops/memoh-dev.sh psql"        # 直连数据库
```

## 协议冒烟测试

改协议相关代码之前/之后跑一遍。它按 iOS 客户端将要走的顺序对活服务端验证一遍，
包括那几条最容易理解错的：发消息的连接收不到正文、必须先订阅、增量是 append。

```bash
node tools/protocol-smoke.mjs
node tools/protocol-smoke.mjs --keep-session   # 保留测试会话便于排查
node tools/protocol-smoke.mjs --base-url http://其他地址
```

## 生产不要照抄的地方

这套环境是**开发用**的，有意做了简化，别拿它当部署模板：

- `config.toml` 里的 admin 密码是脚本生成的随机值，但**没有配 HTTPS**，隧道里走的是明文 HTTP；
- 没有配邮件、没有配 webhook 隧道、没有开连接器 profile；
- 资源上限是按"与生产共存"设的，不是按实际负载调的。
