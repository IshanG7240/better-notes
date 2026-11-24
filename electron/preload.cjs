const { contextBridge, ipcRenderer } = require("electron");
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const prefsAll = ipcRenderer.sendSync("prefs:all") || {};
contextBridge.exposeInMainWorld("api", {
  share: { save: (name, html) => ipcRenderer.invoke("share:save", name, html) },
  prefs: { all: () => prefsAll, set: (k, v) => ipcRenderer.send("prefs:set", k, v) },
  chats: { load: (id) => ipcRenderer.sendSync("chats:load", id), save: (id, part, v) => ipcRenderer.send("chats:save", id, part, v) },
  lifecycle: {
    onFlush: (cb) => ipcRenderer.on("app:flush", () => cb()),
    flushed: () => ipcRenderer.send("app:flushed"),
  },
  boards: {
    list: call("boards:list"),
    load: call("boards:load"),
    save: call("boards:save"),
    remove: call("boards:remove"),
    setGroup: call("boards:setGroup"),
  },
  settings: { get: call("settings:get"), set: call("settings:set") },
  usage: { get: call("usage:get") },
  chat: {
    open: call("chat:open"),
    write: (d) => ipcRenderer.send("chat:write", d),
    resize: (c, r) => ipcRenderer.send("chat:resize", c, r),
    close: call("chat:close"),
    kill: call("chat:kill"),
    pickDir: call("chat:pickDir"),
    onData: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on("chat:data", h);
      return () => ipcRenderer.removeListener("chat:data", h);
    },
    onExit: (cb) => {
      const h = () => cb();
      ipcRenderer.on("chat:exit", h);
      return () => ipcRenderer.removeListener("chat:exit", h);
    },
  },
  chatcli: {
    send: call("chatcli:send"),
    stop: call("chatcli:stop"),
    onEvent: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on("chatcli:event", h);
      return () => ipcRenderer.removeListener("chatcli:event", h);
    },
  },
  workspace: { sync: call("workspace:sync") },
  ai: { agent: call("ai:agent"), onProgress: (cb) => ipcRenderer.on("ai:progress", (_e, p) => cb(p)), cancel: call("ai:cancel") },
});
