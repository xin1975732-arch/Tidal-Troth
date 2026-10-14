# 潮信 · 网页阅读版

账本三部曲第二部《潮信》的网页阅读站。纯静态，不需要任何后端，直接放 GitHub Pages。

功能：书封与目录、接着读、底色与字号、章首潮水动画、听潮海浪声、划线与批注、书签、全文搜索、人物卡片与关系图、时间线（防剧透）、前情提要、金句卡片、我的书房、三部曲导航。划线、书签这些读者数据都存在读者自己的浏览器里。

## 上线

1. 新建仓库（比如 `Tide-Signal`），把这个文件夹里的全部文件传到仓库根目录。
2. 仓库 Settings → Pages → Source 选 **Deploy from a branch**，分支 `main`，目录 `/ (root)`，保存。
3. 一两分钟后访问 `https://你的用户名.github.io/仓库名/`。

## 改了正文以后

正文在 `source/正文.md`，人物、时间线、前情提要在 `source/cx/`。在仓库根目录运行（需要 Python 3）：

```
python3 source/core/build.py source/cx source/正文.md . --standalone --no-social
```

然后把改动提交到 GitHub 即可。
