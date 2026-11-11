# 小朋友英语听写 H5

基于 `npm + Vite` 的 H5 页面版本，可在 iOS、macOS、Android 平板浏览器使用。

## 功能

- 图片/拍照上传词表（OCR 识别）
- 文档上传词表（TXT / DOCX / PDF）
- 英语与中文发音播放
- 手写板输入（不弹出拼音字母键盘）
- 错词统计与记忆曲线复习（本地存储）

## 运行方式

```bash
npm install
npm run dev
```

默认启动后访问 `http://localhost:5173`。

生产构建：

```bash
npm run build
npm run preview
```

## 词表格式建议

每行一个词条，例如：

```txt
apple 苹果
banana - 香蕉
orange: 橙子
```

## 兼容性说明

- `.docx`/`.pdf`/图片在浏览器内解析；`.doc` 老格式不稳定，建议先转成 `.docx` 或 `.pdf`。
- 发音使用浏览器 TTS（`speechSynthesis`），不同设备音色略有差异。
- 手写识别使用浏览器端 OCR，识别率和字迹清晰度有关，必要时可在“识别结果”框做微调。
