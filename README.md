# 桌面萨摩耶宠物 🐕

Mac 桌面悬浮电子宠物——一只会跑、会跳、会撒娇的萨摩耶小狗，集成 Claude Code 状态联动 + AI 对话。

![demo](demo/idle.gif)

---

## 功能

| 功能 | 说明 |
|------|------|
| 🎬 **13 组动画** | 待机、走路、跳跃、坐下、开心摇摆、歪头、抬爪、挠耳、睡觉、摇尾、思考、吐舌、被拖拽 |
| 💬 **AI 对话** | 点击狗狗 → 输入文字 → 回车发送 → 大模型回复 |
| 🤖 **Claude 联动** | 检测 Claude Code 进程状态，思考时歪头、回复完蹦跳庆祝 |
| 🖱️ **桌面交互** | 拖动移位、双击随机动作、自动漫步（避开鼠标）、菜单栏托盘 |
| 🎨 **AI 抠图** | rembg u2net 深度学习模型，绿幕视频 → 透明背景 WebP |

---

## 安装运行

```bash
npm install
npm start
```

## 配置

复制配置模板并填入你的 API 信息：

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "baseUrl": "https://你的中转地址",
  "authToken": "sk-你的密钥",
  "modelName": "qwen3.8-max-preview"
}
```

> `config.json` 已加入 `.gitignore`，不会被提交到仓库。

## 打包

```bash
npm run build
```

产物在 `dist/` 目录：`.dmg` (安装包) + `.zip` (绿色版)。

---

## 项目结构

```
samoyed-pet/
├── main.js              # Electron 主进程（窗口/托盘/移动AI/Claude监控）
├── index.html           # 渲染进程（动画/对话/交互）
├── package.json         # 依赖 & 打包配置
├── config.example.json  # API 配置模板
├── config.json          # 你的 API 配置（gitignore）
├── .gitignore
├── README.md
├── anim/                # WebP 动画素材（13个）
└── assets/              # 原始 MP4 视频（可选）
```

---

## 添加新动画

1. 用 AI 视频工具生成绿幕 MP4，放 `assets/` 目录
2. 运行处理脚本或告诉我文件名，自动抠图 → WebP
3. 在 `index.html` 添加 `<img>` + 状态映射

---

## 技术栈

- **Electron 33** — 桌面壳
- **rembg u2net** — AI 背景去除
- **Anthropic Messages API** — 大模型对话
- **WebP 动画** — 透明通道循环播放
