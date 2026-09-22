module.exports = {
  run: [
    // 1. Clone HashRoyale server source (if not already cloned)
    {
      method: "shell.run",
      params: {
        message: "git clone https://github.com/Hashmane/HashRoyale.git HashRoyale",
        path: "server",
        when: "{{!exists('server/HashRoyale')}}"
      }
    },

    // 2. Retarget the battles project from netcoreapp3.1 to net8.0 (the main project is already net8.0)
    {
      method: "shell.run",
      params: {
        message: "{{which('node')}} scripts/retarget-battles.js",
        when: "{{!exists('server/publish-battles/ClashRoyale.Battles.dll')}}"
      }
    },

    // 3. Apply source patches (config defaults, console fixes, etc.)
    {
      method: "shell.run",
      params: {
        message: "{{which('node')}} scripts/patch-source.js"
      }
    },

    // 4. Install the .NET 8 SDK into env/dotnet. Windows uses the PowerShell
    //    installer (dotnet-install.sh no longer ships Windows support), all
    //    other platforms use the shell script.
    {
      method: "shell.run",
      params: {
        shell: "{{which('bash')}}",
        message: [
          "mkdir -p env",
          "curl -fsSL {{platform === 'win32' ? 'https://dot.net/v1/dotnet-install.ps1' : 'https://dot.net/v1/dotnet-install.sh'}} -o env/dotnet-install.{{platform === 'win32' ? 'ps1' : 'sh'}}",
          "{{platform === 'win32' ? 'powershell -NoProfile -ExecutionPolicy Bypass -File env/dotnet-install.ps1 -Channel 8.0 -InstallDir env/dotnet' : 'bash env/dotnet-install.sh --channel 8.0 --install-dir env/dotnet'}}",
          "rm -f env/dotnet-install.{{platform === 'win32' ? 'ps1' : 'sh'}}"
        ],
        when: "{{!exists('env/dotnet/dotnet' + (platform === 'win32' ? '.exe' : ''))}}"
      }
    },

    // 4. Publish both servers (main + battles) with the .NET SDK
    {
      method: "shell.run",
      params: {
        message: "{{which('node')}} scripts/publish.js"
      }
    },

    // 6. Install an OpenJDK (13+) into env/jdk so we can generate a keystore + sign rebuilt APKs
    {
      method: "shell.run",
      params: {
        conda: "env/jdk",
        message: "conda install -y -c conda-forge \"openjdk>=21\"",
        when: "{{!exists('env/jdk/bin/jarsigner' + (platform === 'win32' ? '.exe' : ''))}}"
      }
    },

    // 7. On macOS there are no official MariaDB tarballs, so install via conda into env/mariadb
    {
      method: "shell.run",
      params: {
        conda: "env/mariadb",
        message: "conda install -y -c conda-forge mariadb",
        when: "{{platform === 'darwin' && !exists('env/mariadb/bin/mariadbd')}}"
      }
    },

    // 8. Download the portable MariaDB archive (Windows / Linux only)
    {
      method: "fs.download",
      params: {
        uri: "https://archive.mariadb.org/mariadb-10.11.19/{{platform === 'win32' ? 'winx64-packages/mariadb-10.11.19-winx64.zip' : 'bintar-linux-systemd-x86_64/mariadb-10.11.19-linux-systemd-x86_64.tar.gz'}}",
        path: "env/mariadb-archive.{{platform === 'win32' ? 'zip' : 'tar.gz'}}"
      },
      when: "{{platform !== 'darwin' && !exists('env/mariadb/bin/mariadbd' + (platform === 'win32' ? '.exe' : ''))}}"
    },

    // 9. Extract the MariaDB archive into env/mariadb (Windows uses the bundled unzip, everything else uses tar)
    {
      method: "shell.run",
      params: {
        shell: "{{which('bash')}}",
        message: [
          "rm -rf env/mariadb-tmp && mkdir -p env/mariadb-tmp env/mariadb",
          "{{platform === 'win32' ? 'unzip -q env/mariadb-archive.zip -d env/mariadb-tmp' : 'tar -xf env/mariadb-archive.tar.gz -C env/mariadb-tmp'}}",
          "{{platform === 'win32' ? 'cp -r env/mariadb-tmp/mariadb-10.11.19-winx64/* env/mariadb/ 2>nul || cp -r env/mariadb-tmp/*/* env/mariadb/' : 'cp -r env/mariadb-tmp/*/* env/mariadb/'}}",
          "rm -rf env/mariadb-tmp env/mariadb-archive.{{platform === 'win32' ? 'zip' : 'tar.gz'}}"
        ],
        when: "{{platform !== 'darwin' && !exists('env/mariadb/bin/mariadbd' + (platform === 'win32' ? '.exe' : ''))}}"
      }
    },

    // 10. Install panel dependencies
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "npm install"
      }
    }
  ]
}