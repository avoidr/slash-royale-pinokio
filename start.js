module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        message: "node app/server.js",
        on: [{
          event: "/(http:\\/\\/[0-9.:]+)/",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
}