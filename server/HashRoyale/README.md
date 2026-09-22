# <p align="center">HashRoyale<p><p align="center">Clash Royale server for version 1.9.2<p>
[![clash royale](https://img.shields.io/badge/Clash%20Royale-1.9.2-brightred.svg?style=flat")](https://clash-royale.en.uptodown.com/android/download/1632865)
[![patched client](https://img.shields.io/badge/Patched_APK-1.9.2-7b00bd)](https://retroroyale.en.malavida.com/android/)
[![wiki](https://img.shields.io/badge/Wiki-HashRoyale-00bd8e)](https://github.com/Hashmane/HashRoyale/wiki)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

-----------------------------------------
## 🏆 Fork Features 🏆
1. New chat commands
2. Infinite number of Admins
3. Player bans
4. Fixed CSV files

## ✅ TODO ✅
1. Access management for chat commands (some commands will be available to regular players, while others will be exclusive to admins)
2. Add new chat commands
3. Finish the Wiki
4. Improve README.md

## Battles
The server supports battles, for those a patched client is neccessary.

[See the wiki for a tutorial](https://github.com/Hashmane/HashRoyale/wiki)

## How to start

#### Requirements:
  - [.NET SDK 8.0](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
  - MySql Database (on Debian i suggest LAMP with PMA or on windows i suggest XAMPP with PMA)

for Ubuntu use these commands to set it up:
```
mkdir ClashRoyale
git clone https://github.com/Hashmane/HashRoyale.git && cd ClashRoyale/src/ClashRoyale

dotnet publish
```
For Windows:
```
git clone https://github.com/Hashmane/HashRoyale.git
cd ClashRoyale/src/ClashRoyale
dotnet publish
```

Run the server once to create the config.json file: ```dotnet bin/Release/net8.0/ClashRoyale.dll```

To configurate your server, such as the database you have to edit the ```config.json``` file.

Run it again to actually start it: ```dotnet bin/Release/net8.0/ClashRoyale.dll```

It should look like this:


![running server](https://i.imgur.com/qPYfRdH.png)

#### Run the server:

###### Main Server:
```dotnet bin/Release/net8.0/ClashRoyale.dll```

###### Battle Server:
```dotnet ClashRoyale.Battles/bin/Release/netcoreapp3.1/ClashRoyale.Battles.dll``` (from /ZrdRoyale/src/)

#### Update the server:
###### Main Server:
```git pull && dotnet publish "ClashRoyale.csproj" -c Release -o app && dotnet bin/Release/net8.0/ClashRoyale.dll```

###### Battle Server:
```git pull && dotnet publish "ClashRoyale.Battles.csproj" -c Release -o app && dotnet ClashRoyale.Battles/bin/Release/netcoreapp3.1/ClashRoyale.Battles.dll```

## Need help?
Contact me on Telegram (https://t.me/alhorm13) or open an issue.