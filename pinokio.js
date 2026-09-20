const path = require("path")

module.exports = {
  version: "7.0",
  title: "Clash Royale Private Server",
  description: "Self-hosted Clash Royale private server (HashRoyale) with web admin panel and APK builder",
  menu: async (kernel, info) => {
    let installed = info.exists("env")
    let installing = info.running("install.js")
    let running = info.running("start.js")
    let updating = info.running("update.js")
    let resetting = info.running("reset.js")
    if (installing) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.js",
      }]
    } else if (installed) {
      if (running) {
        let local = kernel.memory.local[path.resolve(__dirname, "start.js")]
        if (local && local.url) {
          return [{
            default: true,
            icon: "fa-solid fa-rocket",
            text: "Open Panel",
            href: local.url,
          }, {
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start.js",
          }]
        } else {
          return [{
            default: true,
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start.js",
          }]
        }
      } else if (updating) {
        return [{
          default: true,
          icon: "fa-solid fa-arrows-rotate",
          text: "Updating...",
          href: "update.js",
        }]
      } else if (resetting) {
        return [{
          default: true,
          icon: "fa-solid fa-broom",
          text: "Resetting...",
          href: "reset.js",
        }]
      } else {
        return [{
          default: true,
          icon: "fa-solid fa-power-off",
          text: "Start",
          href: "start.js",
        }, {
          icon: "fa-solid fa-arrows-rotate",
          text: "Update",
          href: "update.js",
        }, {
          icon: "fa-solid fa-plug",
          text: "Install",
          href: "install.js",
        }, {
          icon: "fa-solid fa-broom",
          text: "Reset",
          href: "reset.js",
        }]
      }
    } else {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.js",
      }]
    }
  }
}