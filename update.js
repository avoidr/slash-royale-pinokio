module.exports = {
  run: [
    // Pull the latest launcher, panel (app) and game server source (server) from
    // GitHub. This folder is a git clone of the launcher repo, so a single pull
    // at the root updates everything; generated state (env/, server/publish*,
    // app/data) is gitignored and is untouched by the merge.
    {
      method: "shell.run",
      params: {
        message: "git pull"
      }
    },

    // Re-apply the battles retarget patch (upstream may have re-introduced netcoreapp3.1)
    {
      method: "shell.run",
      params: {
        message: "{{which('node')}} scripts/retarget-battles.js",
        when: "{{exists('server/SlashRoyale/src/ClashRoyale.Battles/ClashRoyale.Battles.csproj')}}"
      }
    },

    // Re-publish both servers
    {
      method: "shell.run",
      params: {
        message: "{{which('node')}} scripts/publish.js"
      }
    },

    // Refresh panel dependencies
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "npm install"
      }
    }
  ]
}