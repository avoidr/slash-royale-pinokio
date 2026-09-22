module.exports = {
  run: [
    // Re-apply the battles retarget patch (upstream may have re-introduced netcoreapp3.1)
    {
      method: "shell.run",
      params: {
        message: "{{which('node')}} scripts/retarget-battles.js",
        when: "{{exists('server/HashRoyale/src/ClashRoyale.Battles/ClashRoyale.Battles.csproj')}}"
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