module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: [
          "rmdir /s /q env 2>nul || true",
          "rmdir /s /q app\\node_modules 2>nul || true",
          "rmdir /s /q app\\data 2>nul || true",
          "rmdir /s /q server\\publish 2>nul || true",
          "rmdir /s /q server\\publish-battles 2>nul || true"
        ]
      }
    }
  ]
}