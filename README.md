# HOLO RACK

[CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor/) 的 WebGL 机房主题。每台服务器是机柜里的一块刀片，面板上的风扇、指示灯、表头直接由实时指标驱动；点开刀片，它会从机柜里滑出来，上方投出全息图，右侧展开历史曲线。

在线演示（浏览器内模拟数据）：https://holo-rack.probe-concept-lab.pages.dev

## 刀片上的信息

| 部件 | 含义 |
| --- | --- |
| 双风扇 | 转速跟随 CPU；CPU 超过 60% 叶片背后泛橙光 |
| 蜂窝通风口 | 通电时缓慢呼吸 |
| 三个硬盘位指示灯 | 闪烁频率跟随磁盘 IO（`disk.util` / 读写速率） |
| 四颗线路灯 | 电信 / 联通 / 移动 / BGP 延迟：绿 < 80ms、黄 < 160ms、红更高；超时红灯急闪；未配置的线路熄灭；丢包时灯会抖动 |
| 三行段码表 | CPU / 内存 / 磁盘占用 |
| 两个网口 | 左口下行、右口上行，活动灯闪烁频率跟随网速 |
| 电源灯 | 绿灯在线；离线时红灯闪烁，风扇停转、面板变暗 |
| 面板积灰 | 运行时长越久灰越厚，重启后归零 |
| 红色吊牌 | 7 天内到期（尊重 `show_expire` 与自动续费） |
| 机柜顶部灯条 | 整柜平均负载：冷蓝 → 暖橙 → 过热红，过热时柜顶出现热浪扭曲 |
| 机柜上方全息标牌 | 分组名称与在线点阵 |

机柜按 `server_group` 分组，每柜 12 个槽位，不满的机柜把服务器居中到视线高度。机柜沿弧形排布：数量少时是一面浅弧墙，数量多时环绕成机房，拖动即可环视。

## 交互

- 拖拽旋转、滚轮缩放、右键平移；`WASD` / 方向键环视，`Q` `E` 缩放
- 悬停刀片显示速览卡；点击打开详情（`/#/server/:id`）
- `[` `]` 依次切换服务器，`Esc` 返回机房，`/` 打开搜索

## 安装

在 CF-Server-Monitor 后台的主题设置里填入构建分支的地址：

```
https://github.com/ExploitH/holo-rack/tree/dist
```

`dist` 分支只包含 `index.html` 和 `assets/`，由仓库自带的 GitHub Actions 在每次推送 `main` 后生成。

### 主题选项

登录后台后，顶栏会出现主题设置按钮，保存时调用 `POST /api/theme_options`：

| 键 | 取值 | 默认 |
| --- | --- | --- |
| `group_by` | `group`（按 server_group）/ `region`（按地区）/ `none` | `group` |

## 数据流

严格按照 [主题开发约定](https://github.com/huilang-me/CF-Server-Monitor/blob/main/theme-ai-prompt.md)：

- `/api/config` 全页面只请求一次；启用 Turnstile 时先完成验证，凭证缓存复用
- 首页 `/api/servers` 只请求一次，之后全部走 `wss /api/ws?subscribe=all` + `{type:'subscribe', ids}`；多站模式下每个后端只订阅自己的服务器
- 从首页打开的详情复用 `all` 连接；直接打开的详情页只请求 `/api/server?id=` 与 `/api/history/all`，并使用 `subscribe=<id>`
- 历史曲线只在切换时间范围时请求；1 小时以内的范围会把实时样本续接到曲线末尾
- 页面隐藏时断开 WebSocket，恢复可见时按当前页面补一次 REST 再重连；断线指数退避，遵守 `frontend_ws_timeout_minutes`
- HUD 每秒最多刷新一次；3D 场景每帧向最新值缓动
- 私有站点收到 401 时跳转 `/admin#/admin` 登录

## 开发

```bash
npm install
npm run dev
```

默认使用内置的模拟后端（REST + WebSocket），覆盖离线、丢包、超时、高延迟、即将到期、流量将满、刚重启等情况。模拟后端可以切换成私有站点或开启 Turnstile：

```bash
MOCK_PRIVATE=1 npm run dev     # 在控制台执行 localStorage.jwt_token = 'mock-jwt'; document.cookie = 'cfsm_auth=mock-jwt' 模拟登录
MOCK_TURNSTILE=1 npm run dev   # 使用 Cloudflare 的测试 site key
```

连接真实实例：

```bash
DEV_API_TARGET=https://your-worker.example.com npm run dev
```

国旗与系统图标来自默认皮肤的静态文件（`/flags/`、`/os-icons/`），不会打包进主题。开发时默认从同级目录的 CF-Server-Monitor 仓库 `public/` 读取，可用 `UPSTREAM_PUBLIC` 指定。

### 构建

```bash
npm run build        # dist/：主题本体
npm run build:demo   # dist-demo/：自带模拟后端的离线演示
```

### 部署到 GitHub Pages

1. 在仓库 Settings → Secrets 中按需添加 `API_BASE`（多个用英文逗号分隔）、`TITLE`、`CSP_API`、`CSP_STATIC`
2. Settings → Actions → General 里给工作流开启写权限
3. Settings → Pages 选择 `dist` 分支作为来源
4. 在每个 Worker 的环境变量 `CORS_ALLOWED_ORIGINS` 中加入 Pages 域名（只填 origin）

不设置 Secrets 时，`dist` 分支就是供主题代理使用的通用构建。

## 技术栈

Vue 3 + Vite，three.js 打包进 `assets/`（满足后端的 CSP：不加载外部脚本、不使用 eval / wasm）。所有刀片面板、机身、名牌都是 InstancedMesh，指标作为实例属性写入，数百台服务器仍是个位数的绘制调用；面板细节全部在片元着色器里程序化生成。后期处理：HalfFloat 多重采样 → 热浪扭曲 → Bloom → ACES → 暗角 / 颗粒 / 色差。

## 许可

MIT。`src/net/` 与 `src/utils/format.js` 中的接口调用、Turnstile 流程、计费与流量算法参照 CF-Server-Monitor（MIT, © huilang-me）实现。
