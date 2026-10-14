/* 账本三部曲 · 阅读器后端 backend.js —— kit v2.1（GitHub Pages 版）
 *
 * 在 GitHub Pages 上没有 claude.ai 的能力，这个文件用 Supabase 把同样的接口补上：
 *   window.claude.use("db" | "user" | "downloads")   features.js 用的就是这几个
 *   window.READER_AUTH.login() / logout()              邮箱 + 验证码登录，第一次登录起昵称（不能重名）
 *
 * 加载顺序：supabase.js → config.js → backend.js → reader.js → features.js
 * config.js 里写：window.READER_BACKEND = { url: "https://xxx.supabase.co", anonKey: "eyJ..." }
 * 建表和权限见 supabase/schema.sql。
 */
(function () {
  "use strict";
  var CFG = window.READER_BACKEND || {};
  var sb = null;
  try {
    if (window.supabase && CFG.url && CFG.anonKey && CFG.url.indexOf("你的") < 0) {
      sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    }
  } catch (e) { sb = null; }

  var session = null, profile = null, admin = false;

  function loadProfile() {
    if (!sb || !session) return Promise.resolve();
    return Promise.all([
      sb.from("profiles").select("id,nickname,created_at").eq("id", session.user.id).maybeSingle(),
      sb.rpc("is_admin")
    ]).then(function (r) {
      profile = (r[0] && r[0].data) || null;
      admin = !!(r[1] && r[1].data);
    }, function () {});
  }
  var ready = !sb ? Promise.resolve() : sb.auth.getSession().then(function (r) {
    session = (r && r.data && r.data.session) || null;
    return loadProfile();
  }, function () {});

  /* ---------- 头像：昵称第一个字 ---------- */
  var COLORS = ["#E8590C", "#D6336C", "#1C7ED6", "#2B8A3E", "#7048E8", "#E67700", "#0C8599", "#C2255C"];
  function colorOf(id) { var h = 0; String(id).split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return COLORS[h % COLORS.length]; }
  function avatar(name, id) {
    var ch = (name || "读").slice(0, 1);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="' + colorOf(id) +
      '"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">' +
      ch.replace(/[<&>"]/g, "") + "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  /* ---------- db：一张 docs 表，path 是主键，coll 是所在集合 ----------
   * 三本书可以共用一个 Supabase 项目（共用账号和昵称）：存的时候在前面加上书的 key，比如 "cx:u/<id>"。 */
  var P = ((window.BOOK && window.BOOK.key) || "book") + ":";
  function collOf(path) { return path.split("/").slice(0, -1).join("/"); }
  function errOf(e) {
    var c = e && (e.code || "");
    if (c === "42501" || c === "PGRST301" || /row-level security|permission/i.test((e && e.message) || "")) return { code: "invalid_argument", message: e.message };
    if (c === "23514") return { code: "quota_exceeded", message: e.message };
    return { code: "unavailable", message: (e && e.message) || "" };
  }
  function snap(path, row) {
    var d = row ? row.data : undefined;
    return { id: path.split("/").pop(), exists: !!row, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  var subs = [];   // {coll, run}
  var notifyT = {};
  function notify(coll) {
    clearTimeout(notifyT[coll || "*"]);
    notifyT[coll || "*"] = setTimeout(function () {
      subs.forEach(function (s) { if (!coll || s.coll === coll) s.run(); });
    }, 250);
  }
  if (sb) {
    try {
      sb.channel("docs-live").on("postgres_changes", { event: "*", schema: "public", table: "docs" }, function (p) {
        var c = (p && p.new && p.new.coll) || (p && p.old && p.old.coll) || "";
        notify(c);
      }).subscribe();
    } catch (e) {}
    // 实时推送没开或者断了的时候，每 30 秒自己刷一次
    setInterval(function () { if (!document.hidden && subs.length) notify(""); }, 30000);
  }

  function docRef(lpath) {
    var path = P + lpath, coll = P + collOf(lpath);
    var ref = {
      id: lpath.split("/").pop(), path: lpath,
      get: function () {
        return sb.from("docs").select("data").eq("path", path).maybeSingle().then(function (r) {
          if (r.error) throw errOf(r.error);
          return snap(path, r.data);
        });
      },
      set: function (data) {
        return sb.from("docs").upsert({ path: path, coll: coll, data: data, updated_at: new Date().toISOString() }, { onConflict: "path" }).then(function (r) {
          if (r.error) throw errOf(r.error);
          notify(coll);
        });
      },
      update: function (part) {
        return ref.get().then(function (s) {
          if (!s.exists) throw { code: "invalid_argument", message: "document does not exist" };
          var d = s.data();
          Object.keys(part).forEach(function (k) { d[k] = part[k]; });
          return sb.from("docs").update({ data: d, updated_at: new Date().toISOString() }).eq("path", path).select("path").then(function (r) {
            if (r.error) throw errOf(r.error);
            if (!r.data || !r.data.length) throw { code: "invalid_argument", message: "not allowed" };
            notify(coll);
          });
        });
      },
      delete: function () {
        return sb.from("docs").delete().eq("path", path).then(function (r) { if (r.error) throw errOf(r.error); notify(coll); });
      },
      onSnapshot: function (next, err) {
        var alive = true;
        var s = { coll: coll, run: function () { if (alive) ref.get().then(function (x) { if (alive) next(x); }, function (e) { if (alive && err) err(e); }); } };
        subs.push(s); s.run();
        return function () { alive = false; subs = subs.filter(function (x) { return x !== s; }); };
      },
      collection: function (sub) { return collRef(lpath + "/" + sub); }
    };
    return ref;
  }
  function collRef(lcoll) {
    var coll = P + lcoll;
    var ref = {
      path: lcoll,
      get: function () {
        return sb.from("docs").select("path,data").eq("coll", coll).limit(1000).then(function (r) {
          if (r.error) throw errOf(r.error);
          var docs = (r.data || []).map(function (row) { return snap(row.path, row); });
          return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
        });
      },
      onSnapshot: function (next, err) {
        var alive = true;
        var s = { coll: coll, run: function () { if (alive) ref.get().then(function (x) { if (alive) next(x); }, function (e) { if (alive && err) err(e); }); } };
        subs.push(s); s.run();
        return function () { alive = false; subs = subs.filter(function (x) { return x !== s; }); };
      },
      doc: function (id) { return docRef(lcoll + "/" + (id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)))); },
      add: function (data) { var d = ref.doc(); return d.set(data).then(function () { return d; }); }
    };
    return ref;
  }
  var db = { doc: docRef, collection: collRef };

  /* ---------- user ---------- */
  var nameCache = {};
  var user = {
    id: function () { return ready.then(function () { return session && profile ? session.user.id : null; }); },
    me: function () {
      return ready.then(function () {
        var id = session && profile ? session.user.id : null;
        var nm = profile ? profile.nickname : "";
        return { id: id, name: nm, avatarUrl: avatar(nm, id || "x"), color: colorOf(id || "x"), email: session ? session.user.email : null, isOwner: admin, canEdit: admin, joined: profile ? profile.created_at : null };
      });
    },
    can: function () { return ready.then(function () { return !!(session && profile); }); },
    isOwner: function () { return admin; },
    canEdit: function () { return admin; },
    profiles: function (ids) {
      ids = [].concat(ids).filter(Boolean).filter(function (x, i, a) { return a.indexOf(x) === i; });
      var need = ids.filter(function (i) { return !nameCache[i]; });
      var p = need.length ? sb.from("profiles").select("id,nickname").in("id", need).then(function (r) {
        (r.data || []).forEach(function (row) { nameCache[row.id] = row.nickname; });
      }, function () {}) : Promise.resolve();
      return p.then(function () {
        var out = {};
        ids.forEach(function (i) {
          var nm = nameCache[i] || "";
          out[i] = { id: i, name: nm, avatarUrl: avatar(nm, i), color: colorOf(i), email: null, isMe: !!(session && session.user.id === i), guest: false };
        });
        return out;
      });
    }
  };

  /* ---------- downloads：浏览器直接下载 ---------- */
  var downloads = {
    save: function (req) {
      return new Promise(function (res) {
        var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url; a.download = req.filename || "download";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        res({ status: "saved" });
      });
    }
  };

  window.claude = {
    use: function (name) {
      return ready.then(function () {
        if (name === "downloads") return downloads;
        if (!sb) return null;
        if (name === "db") return db;
        if (name === "user") return user;
        return null;
      });
    }
  };

  /* ---------- 登录：邮箱 → 验证码 → 昵称 ---------- */
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function login() {
    if (!sb) { alertBox("评论功能还没有配置好。"); return; }
    var box = el("div", { class: "auth" });
    var msg = el("p", { class: "tip", role: "status", "aria-live": "polite" });
    var step1 = el("form", { class: "cm-f" });
    step1.appendChild(el("p", { class: "lede" }, "输入邮箱，我们会发一个 6 位验证码给你。不用密码。"));
    var email = el("input", { type: "email", id: "authEmail", required: "", placeholder: "你的邮箱", autocomplete: "email", "aria-label": "邮箱" });
    step1.appendChild(email);
    var r1 = el("div", { class: "row" }); var b1 = el("button", { type: "submit", class: "btn-s pri" }, "发送验证码"); r1.appendChild(b1); step1.appendChild(r1);

    var step2 = el("form", { class: "cm-f" }); step2.hidden = true;
    var code = el("input", { type: "text", id: "authCode", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "10", placeholder: "邮箱里的验证码", "aria-label": "验证码" });
    step2.appendChild(code);
    var r2 = el("div", { class: "row" });
    var back = el("button", { type: "button", class: "btn-s ghost" }, "换个邮箱");
    var b2 = el("button", { type: "submit", class: "btn-s pri" }, "登录");
    r2.appendChild(back); r2.appendChild(b2); step2.appendChild(r2);

    var step3 = el("form", { class: "cm-f" }); step3.hidden = true;
    step3.appendChild(el("p", { class: "lede" }, "给自己起个昵称，评论时显示的就是它。不能和别人重名，以后可以在“我的书房”里改。"));
    var nick = el("input", { type: "text", id: "authNick", maxlength: "20", placeholder: "昵称（1–20 个字）", "aria-label": "昵称" });
    step3.appendChild(nick);
    var r3 = el("div", { class: "row" }); var b3 = el("button", { type: "submit", class: "btn-s pri" }, "好了"); r3.appendChild(b3); step3.appendChild(r3);

    box.appendChild(step1); box.appendChild(step2); box.appendChild(step3); box.appendChild(msg);
    var sh = window.Reader ? window.Reader.sheet({ title: "登录", body: box }) : null;
    if (session && !profile) { step1.hidden = true; step3.hidden = false; setTimeout(function () { nick.focus(); }, 80); }
    else setTimeout(function () { email.focus(); }, 80);

    step1.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { msg.textContent = "邮箱格式不对。"; return; }
      b1.disabled = true; msg.textContent = "正在发送……";
      sb.auth.signInWithOtp({ email: v, options: { shouldCreateUser: true } }).then(function (r) {
        b1.disabled = false;
        if (r.error) { msg.textContent = /rate|seconds/i.test(r.error.message) ? "发得太频繁了，过一分钟再试。" : "没发出去：" + r.error.message; return; }
        step1.hidden = true; step2.hidden = false; msg.textContent = "验证码已发到 " + v + "，几分钟内有效。没收到的话看看垃圾邮件。";
        code.focus();
      });
    });
    back.addEventListener("click", function () { step2.hidden = true; step1.hidden = false; msg.textContent = ""; });
    step2.addEventListener("submit", function (e) {
      e.preventDefault();
      var t = code.value.replace(/\s/g, "");
      if (!t) return;
      b2.disabled = true; msg.textContent = "正在登录……";
      sb.auth.verifyOtp({ email: email.value.trim(), token: t, type: "email" }).then(function (r) {
        b2.disabled = false;
        if (r.error) { msg.textContent = "验证码不对或者过期了。"; return; }
        session = r.data.session;
        loadProfile().then(function () {
          if (profile) { done(); return; }
          step2.hidden = true; step3.hidden = false; msg.textContent = ""; nick.focus();
        });
      });
    });
    step3.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = nick.value.trim();
      if (!n || n.length > 20) { msg.textContent = "昵称要 1 到 20 个字。"; return; }
      b3.disabled = true;
      saveNick(n).then(function (err) {
        b3.disabled = false;
        if (err) { msg.textContent = err; return; }
        done();
      });
    });
    function done() { if (sh) sh.close(); location.reload(); }
  }
  function saveNick(n) {
    var row = { id: session.user.id, nickname: n };
    var q = profile ? sb.from("profiles").update({ nickname: n }).eq("id", session.user.id) : sb.from("profiles").insert(row);
    return q.then(function (r) {
      if (!r.error) { profile = profile || {}; profile.nickname = n; nameCache[session.user.id] = n; return null; }
      if (r.error.code === "23505") return "这个昵称已经有人用了，换一个吧。";
      if (r.error.code === "23514") return "昵称要 1 到 20 个字。";
      return "没保存成功：" + r.error.message;
    });
  }
  function rename() {
    if (!sb || !session || !profile) return;
    var box = el("div", { class: "auth" });
    var f = el("form", { class: "cm-f" });
    var nick = el("input", { type: "text", id: "authNick2", maxlength: "20", "aria-label": "新昵称" });
    nick.value = profile.nickname;
    var msg = el("p", { class: "tip", role: "status" });
    var r = el("div", { class: "row" }); var b = el("button", { type: "submit", class: "btn-s pri" }, "保存");
    r.appendChild(b); f.appendChild(nick); f.appendChild(r); box.appendChild(f); box.appendChild(msg);
    var sh = window.Reader.sheet({ title: "改昵称", body: box });
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var n = nick.value.trim();
      if (!n) return;
      saveNick(n).then(function (err) { if (err) msg.textContent = err; else { sh.close(); location.reload(); } });
    });
  }
  function alertBox(t) { if (window.Reader) window.Reader.toast(t); }

  window.READER_AUTH = {
    login: login,
    rename: rename,
    logout: function () { if (sb) sb.auth.signOut().then(function () { location.reload(); }); },
    loggedIn: function () { return !!(session && profile); },
    hasSession: function () { return !!session; },
    ready: ready
  };
  // 登录了但还没起昵称（上次中途关掉了）：提示补上
  ready.then(function () { if (session && !profile) setTimeout(function () { if (window.Reader) { login(); } }, 600); });
})();
