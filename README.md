# FORM / 10 — 3D 作品集网站

一个可以直接部署到 GitHub Pages 的静态 3D 作品集：10 个展示位，作品以封面 / 实时 GLB 两种方式呈现，内置上传、预览、封面截取和发布包导出。

> 详细图文步骤见 **`guide.html`**（网站内「GitHub 发布指南」）。这份 README 是速查版。

---

## 1. 直接看

双击 **`本地预览.bat`**，会启动一个不依赖 Python / Node 的本地服务器，并打开：

```
http://127.0.0.1:8080/
```

不要直接双击 `index.html`：网站使用 ES Modules 和 `fetch` 读取 `data/works.json`，`file://` 协议会被浏览器拦截。

也可以用任意静态服务器：

```bash
python -m http.server 8080
# 或 VS Code 的 Live Server
```

---

## 2. 功能

- **10 个展示位**：1–7 已放入现有作品封面，8–10 为开放位。
- **实时 3D**：支持 GLB / GLTF（含外部 .bin / 贴图）、OBJ、STL；支持 Draco 压缩的 GLB。
- **精确的操作映射**：
  - 电脑：左键拖动平移、中键拖动旋转、滚轮缩放。
  - 手机：单指滑动旋转、双指捏合缩放。
- **策展台**：上传 / 替换模型，填写标题、类型、说明，截取当前视角作为 4:5 封面。
- **本地保存**：文件保存在浏览器 IndexedDB，刷新和重启浏览器后仍在。
- **发布包导出**：一键生成包含 `models/`、`covers/`、`data/works.json` 的 ZIP，拖到 GitHub 即可公开。
- **无构建步骤**：Three.js、JSZip 均已放在 `vendor/`，不需要 npm install。

---

## 3. 发布到 GitHub Pages（5 步）

1. GitHub 新建 **Public** 仓库，例如 `form10`。
2. 把本文件夹**里面的内容**上传到仓库根目录，确认根目录能直接看到 `index.html`。
3. 仓库 **Settings → Pages**：Source = `Deploy from a branch`，Branch = `main`，目录 = `/ (root)`，Save。
4. 等 1–3 分钟，访问 `https://你的用户名.github.io/form10/`。
5. 之后每次加模型：在策展台导出发布包，把 `models/`、`covers/`、`data/works.json` 上传并覆盖，Commit。

完整说明（含 Blender 导出参数、404 排查、文件限制）见 [`guide.html`](guide.html)。

---

## 4. 加一个新模型

### 方式 A：用网站策展台（推荐）

1. 本地或线上打开网站 → 右上角「策展台」。
2. 选择第 8–10 个空位，或「替换」已有作品。
3. 拖入 `.glb`，填写作品名 / 类型 / 说明，保存。
4. 在 3D 预览里调整角度 →「截取封面」。
5. 回到策展台 →「导出发布包」。
6. 解压 ZIP，把 `models/`、`covers/`、`data/works.json` 上传到 GitHub 仓库根目录。
7. 等 Pages 部署完成，用无痕窗口检查线上版本。

> 策展台上传只保存在**当前浏览器**。不导出、不提交到 GitHub，访客看不到。

### 方式 B：手动改文件

```text
models/slot-08/character.glb
assets/covers/08.webp
```

然后编辑 `data/works.json` 对应展示位：

```json
{
  "slot": 8,
  "title": "角色名",
  "category": "character",
  "role": "3D 角色 / 风格化",
  "cover": "assets/covers/08.webp",
  "model": "models/slot-08/character.glb",
  "description": "一句话说明。",
  "specs": ["2K 贴图", "Blender / Substance 3D Painter"]
}
```

`model` / `cover` 都是**相对网站根目录**的路径，且大小写敏感。

---

## 5. Blender 导出 GLB

`File → Export → glTF 2.0`

| 项目 | 设置 |
| --- | --- |
| 格式 | glTF Binary (`.glb`) |
| 包含 | Selected Objects（只选角色 / 道具） |
| 变换 | `+Y Up`，Apply Modifiers |
| 数据 | UV、Normals；需要再勾 Tangents |
| 材质 | Export Materials；Images = Automatic |
| 相机 / 灯光 | 不导出 |
| 压缩 | Draco 可选（网站已支持） |
| 体积 | 建议 ≤ 20MB；GitHub 单文件硬上限 100MB |

导出前建议 `Object → Apply → All Transforms`，并把原点放在脚底中心。贴图优先 2K，角色控制在 5–15 万三角面以内。

---

## 6. 目录

```text
作品集网站/
├── index.html
├── guide.html
├── 本地预览.bat
├── data/
│   └── works.json          # 10 个展示位的数据
├── models/                 # 发布后的模型（当前为空）
├── assets/
│   ├── covers/             # 7 张作品封面 WebP
│   ├── cover-placeholder.svg
│   ├── og-cover.jpg
│   └── favicon.svg
├── css/
│   ├── base.css
│   ├── style.css
│   ├── viewer.css
│   ├── guide.css
│   └── responsive.css
├── js/
│   ├── app.js              # 页面、策展台、上传、导出
│   ├── viewer.js           # Three.js 场景与加载器
│   ├── controls.js         # 精确的鼠标 / 触摸控制
│   ├── hero.js             # 首页 3D 装饰
│   └── db.js               # IndexedDB
├── tools/
│   └── serve.ps1           # 无依赖本地服务器
└── vendor/
    ├── three/              # Three.js 0.187 + loaders + Draco
    └── jszip/              # 导出发布包
```

---

## 7. 改个人信息

打开 `data/works.json` 顶部的 `meta`：

```json
"artist": "你的名字",
"email": "你的邮箱",
"wechat": "你的微信号",
"artstation": "https://www.artstation.com/你的主页",
"statement": "你的自我介绍",
"tools": ["Blender", "ZBrush", "Substance 3D Painter", "Marmoset", "Photoshop"]
```

首页的姓名、邮箱、微信号、作品数量和页脚会自动更新。

---

## 8. 容量与限制

- GitHub Pages：仓库建议 ≤ 1GB，单文件 < 100MB，月流量约 100GB。
- 网站十个展示位：模型 + 封面合计建议 ≤ 200MB。
- 浏览器 IndexedDB 容量取决于设备和浏览器；超大文件可能保存失败。
- GitHub Pages 是静态托管，**没有后端**，不能让访客上传文件并永久保存。
- 不要用 Git LFS 存 GLB：Pages 不会解析 LFS 指针。

---

## 9. 常见问题

**页面 404 / 空白？**  
确认仓库 Public、Pages 分支 `main` / root、`index.html` 在根目录；F12 看 `data/works.json` 是否 404。

**模型一直 LOADING？**  
优先单文件 GLB；检查 `model` 路径、大小写、文件是否随仓库上传；带贴图的 GLTF 必须把 `.bin` 和 textures 一起上传。

**手机手势冲突？**  
查看器的画布设置了 `touch-action: none`；请按在模型区域上操作，不要按在右侧信息面板。

**更新后还是旧版？**  
看仓库 Actions 的 Pages 部署状态，用无痕窗口或 `Ctrl/Cmd + Shift + R` 强制刷新。

---

## 10. 第三方

- [Three.js](https://threejs.org/) — MIT，见 `vendor/three/LICENSE`。
- [JSZip](https://stuk.github.io/jszip/) — MIT。
- 作品封面来自原作品集 `作品集生成/输出/上传用图/`，版权归作者本人。

本站没有后端、没有统计脚本、没有外部字体请求。所有依赖均在仓库内，可在离线环境下本地预览。
