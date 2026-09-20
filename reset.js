module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        shell: "{{which('bash')}}",
        message: [
          "rm -rf env app/node_modules app/data server/publish server/publish-battles"
        ]
      }
    }
  ]
}