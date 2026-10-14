# 潮信 · 网页阅读版

账本三部曲第二部《潮信》的网页阅读站。纯静态页面，放在 GitHub Pages 上；评论、读后感、阅读统计存在 Supabase 里。

- 不用登录就能用：划线、批注、书签、全文搜索、人物卡片和关系图、时间线、前情提要、金句卡片、我的书房（数据存在读者自己的浏览器里）。
- 登录后能用：章末评论、段落评论、回复、点赞、读后感、读者主页。登录方式是**邮箱 + 验证码**，第一次登录起一个昵称，昵称不能和别人重复，之后在“我的书房”里可以改。
- 作者能用：作者后台（读者人数、打开次数、每章读完率、人均阅读时长、热门划线、删除任何评论、修改前情提要）。

## 目录

```
index.html            整本书（单页，所有章节都在里面）
ch01.html…ch20.html   旧链接的跳转页
reader.css / reader.js / features.css / features.js   阅读器（三部曲共用）
theme.css             《潮信》自己的颜色和封面
backend.js            Supabase 接口：邮箱验证码登录、昵称、评论数据
config.js             ← 要填你自己的 Supabase 地址和 key
supabase/schema.sql   建表脚本
source/               重新生成网页用的源文件（正文、人物、时间线、前情提要、构建脚本）
```

## 第一次上线

### 1. 放到 GitHub

1. 新建仓库，比如 `Tide-Signal`，把这个文件夹里的全部文件传上去（`source/` 也一起传，方便以后改）。
2. 仓库 Settings → Pages → Build and deployment：Source 选 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`，保存。
3. 过一两分钟，网址是 `https://你的用户名.github.io/仓库名/`。

到这一步，阅读、划线、搜索这些已经能用了。评论区会显示“暂时连不上”，做完下面几步就好。

### 2. 建 Supabase 项目

三本书可以共用同一个 Supabase 项目：数据按书分开存，读者在三本书里用同一个账号和昵称。

1. 在 supabase.com 新建一个项目（免费版够用）。
2. 左侧 **SQL Editor** → New query → 把 `supabase/schema.sql` 整个贴进去 → Run。可以重复运行，不会删数据。
3. **Project Settings → API**：复制 `Project URL` 和 `anon public` key，填进仓库里的 `config.js`。anon key 本来就是公开的，可以放进仓库。

### 3. 设置邮件验证码

1. **Authentication → Sign In / Providers → Email**：确认 Email 是开着的。Email OTP Length 用 6 位。
2. **Authentication → Emails → Templates**：把 **Magic Link** 和 **Confirm signup** 两个模板都改成显示验证码，比如：

   ```html
   <h2>《潮信》登录验证码</h2>
   <p>你的验证码是：<strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>几分钟内有效。如果不是你本人操作，忽略这封邮件就好。</p>
   ```

   要点是模板里必须有 `{{ .Token }}`。只有链接的话，读者收到的是登录链接，不是验证码。
3. **Authentication → Emails → SMTP Settings**：**一定要配自己的发信邮箱**。Supabase 自带的发信服务只能发给你项目团队成员的邮箱，而且每小时只有几封，普通读者收不到。可以用 QQ 邮箱或 163 邮箱的 SMTP（在邮箱设置里开启 SMTP，拿“授权码”当密码），也可以用 Resend 这类发信服务的免费额度。
4. **Authentication → URL Configuration**：Site URL 填你的 GitHub Pages 网址。

### 4. 把自己设成作者

1. 打开网页，随便在一章的评论区点“邮箱登录”，用你自己的邮箱登录，起好昵称。
2. 回到 Supabase 的 SQL Editor，运行（邮箱换成你的）：

   ```sql
   insert into public.admins (user_id) select id from auth.users where email = '你的邮箱' on conflict do nothing;
   ```

3. 刷新网页。书封和“我的书房”里会出现“作者后台”。

## 以后改了正文怎么更新

正文在 `source/正文.md`，人物、时间线、前情提要在 `source/books/cx/`。改完以后在仓库根目录运行（需要 Python 3）：

```
python3 source/core/build.py source/books/cx source/正文.md . --standalone --backend
```

它会重新生成 `index.html` 和各个页面，不会覆盖你已经填好的 `config.js`。然后把改动提交到 GitHub，一两分钟后网页就更新了。

前情提要也可以不改文件，直接在网页的作者后台里改。

## 说明

- 评论和读后感只有登录的读者能发，没登录的人也能看到。
- 阅读统计只统计登录过的读者。
- 删除评论：自己的评论自己能删，作者能删任何人的。
- 三部曲另外两本要接同一套登录和评论：把 `backend.js` 和 `config.js`（同样的 url 和 key）放进它们的仓库，构建时加 `--backend`。不需要另外建表。
