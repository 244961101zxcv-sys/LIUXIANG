# models

发布后的 3D 模型放在这里，按展示位建子目录：

```text
models/
├── slot-01/
│   └── character.glb
├── slot-08/
│   ├── character.glb
│   └── textures/...
```

然后在 `data/works.json` 对应条目里写：

```json
"model": "models/slot-08/character.glb"
```

推荐单文件 GLB。GLTF + `.bin` + 贴图也可以，但必须保持相对路径一起上传。

GitHub Pages 上路径区分大小写，单个文件不得超过 100MB。详情见根目录 `guide.html`。
