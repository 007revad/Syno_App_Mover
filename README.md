# <img src="images/icon.png" width="54"> Syno App Mover package

<a href="https://github.com/007revad/Synology_app_mover/releases"><img src="https://img.shields.io/github/release/007revad/Syno_App_Mover.svg"></a>
![Badge](https://hitscounter.dev/api/hit?url=https%3A%2F%2Fgithub.com%2F007revad%2FSyno_App_Mover&label=Visitors&icon=github&color=%23198754&message=&style=flat&tz=Australia%2FSydney)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://www.paypal.com/paypalme/007revad)
[![](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/007revad)
<!-- [![committers.top badge](https://user-badge.committers.top/australia/007revad.svg)](https://user-badge.committers.top/australia/007revad) -->

### Description

Easily move Synology packages from one volume to another volume, or backup and restore them.

  - When restoring a package that package must already be installed.

Handy for moving packages to an SSD volume, or to another volume so you can delete the original volume.

  - Supports DSM 7. Not fully tested with DSM 6.
  - If backing up to a USB drive the partition's file system should be ext3, ext4 of btrfs.

Container Manager and Docker are currently excluded because they can cause issues.

### Packages confirmed working

**NOTE:** Just in case, you should backup your docker compose files or portainer stacks.

<details>
  <summary>Click here to see list</summary>

<img src="/images/icons/.png" width="16" height="16"> 

The icons in this table are [Copyright © 2004-2026 Synology Inc.](https://kb.synology.com/en-br/DSM/help/DSM/Home/about?version=7) or Copyright the 3rd party package developer.

| Package Center Name | System Name | Result |
|---------------------|-------------|--------|
| <img src="/images/icons/ActiveBackup_business_64.png" width="16" height="16"> Active Backup for Business | ActiveBackup | OK |
| <img src="/images/icons/ActiveBackup-GSuite_64.png" width="16" height="16"> Active Backup for Google Workspace | ActiveBackup-GSuite | OK |
| <img src="/images/icons/ActiveBackup-Office365_64.png" width="16" height="16"> Active Backup for Microsoft 365 | ActiveBackup-Office365 | OK |
| <img src="/images/icons/CodecPack_64.png" width="16" height="16"> Advanced Media Extensions | CodecPack | OK |
| <img src="/images/icons/AntiVirus-McAfee_64.png" width="16" height="16"> AntiVirus by McAfee | AntiVirus-McAfee | OK |
| <img src="/images/icons/anti_virus_64.png" width="16" height="16"> AntiVirus Essential | AntiVirus | OK - [Use v4.2.88 or later](https://github.com/007revad/Synology_app_mover/releases) |
| <img src="/images/icons/apache_64.png" width="16" height="16"> Apache HTTP Server 2.4 | Apache2.4 | OK |
| <img src="/images/icons/bb-qq_64.png" width="16" height="16"> AQC111 driver | aqc111 | OK - 3rd party package [link](https://github.com/bb-qq/aqc111) |
| <img src="/images/icons/AudioStation_64.png" width="16" height="16"> Audio Station | AudioStation | OK |
| <img src="/images/icons/AvrLogger_64.png" width="20" height="20"> AvrLogger | AvrLogger | OK - community package [link](https://luenepiet.de/public/Synology/AvrLogger%20(SPK)/) |
| <img src="/images/icons/BitDefenderForMailPlus_64.png" width="16" height="16"> Bitdefender for MailPlus | BitDefenderForMailPlus | OK I think |
| <img src="/images/icons/C2IdentityLDAPAgent_64.png" width="16" height="16"> C2 Identity LDAP Server | C2IdentityLDAPAgent | OK |
| <img src="/images/icons/CMS_64.png" width="16" height="16"> Central Management System | CMS | OK |
| <img src="/images/icons/ChannelsDVR_64.png" width="16" height="16"> Channels DVR | ChannelsDVR | OK - 3rd party package [link](https://getchannels.com/dvr-server/#synology) |
| <img src="/images/icons/CloudSync_64.png" width="16" height="16"> Cloud Sync | CloudSync | OK |
| <img src="/images/icons/ContainerManager_64.png" width="16" height="16"> Container Manager 24.0.2-1606 | ContainerManager | **No** - New script version coming soon |
| <img src="/images/icons/ContainerManager_64.png" width="16" height="16"> Container Manager 24.0.2-1535 to 1543 | ContainerManager | OK - [Some issues moving docker folder](github.com/007revad/Synology_app_mover/issues/216) |
| <img src="/images/icons/ContainerManager_64.png" width="16" height="16"> Container Manager 20.10.23 | ContainerManager | OK - Can have issues with broken containers |
| <img src="/images/icons/DNSServer_64.png" width="16" height="16"> DNS Server | DNSServer | OK |
| <img src="/images/icons/docker_64.png" width="20" height="20"> Docker | Docker | OK |
| <img src="/images/icons/DocumentViewer_64.png" width="16" height="16"> Document Viewer | DocumentViewer | OK |
| <img src="/images/icons/download_station_64.png" width="20" height="20"> Download Station | DownloadStation | OK |
| <img src="/images/icons/EmbyServer_64.png" width="16" height="16"> Emby Server | EmbyServer | OK |
| <img src="/images/icons/exFAT-Free_72.png" width="16" height="16"> exFAT Access | exFAT-Free | OK |
| <img src="/images/icons/ffmpeg_72.png" width="18" height="18"> FFmpeg | ffmpeg# | OK - community package |
| <img src="/images/icons/Git_64.png" width="16" height="16"> Git | git | OK - community package |
| <img src="/images/icons/Git_64.png" width="16" height="16"> Git Server | Git | OK |
| <img src="/images/icons/GlacierBackup_64.png" width="16" height="16"> Glacier Backup | GlacierBackup | OK - Need to run backup task again |
| <img src="/images/icons/HyperBackup_64.png" width="16" height="16"> Hyper Backup | HyperBackup | OK |
| <img src="/images/icons/HyperBackupVault_64.png" width="16" height="16"> Hyper Backup Vault | HyperBackupVault | OK |
| <img src="/images/icons/jellyfin-64.png" width="20" height="20"> Jellyfin | jellyfin | OK |
| <img src="/images/icons/DirectoryServer_64.png" width="16" height="16"> LDAP Server | DirectoryServer | OK |
| <img src="/images/icons/LogAnalysis_64.png" width="16" height="16"> LogAnalysis | LogAnalysis | OK - community package [link](https://github.com/toafez/LogAnalysis) |
| <img src="/images/icons/log_center_64.png" width="16" height="16"> Log Center | LogCenter | OK |
| <img src="/images/icons/MailStation_64.png" width="16" height="16"> Mail Station | MailStation | OK |
| <img src="/images/icons/MariaDB10_64.png" width="20" height="20"> MariaDB 10 | MariaDB10 | OK |
| <img src="/images/icons/MediaServer_64.png" width="16" height="16"> Media Server | MediaServer | OK |
| <img src="/images/icons/mediainfo-64.png" width="16" height="16"> MediaInfo | mediainfo | OK - community package |
| <img src="/images/icons/MinimServer_64.png" width="16" height="16"> MinimServer | MinimServer | OK |
| <img src="/images/icons/Mosquitto_64.png" width="16" height="16"> Mosquitto | mosquitto | OK - community package |
| <img src="/images/icons/phpMyAdmin_72.png" width="20" height="20"> phpMyAdmin | phpMyAdmin | OK |
| <img src="/images/icons/Node.js_cropped.png" width="36" height="17"> Node.js | Node.js_v## | OK |
| <img src="/images/icons/NoteStation_64.png" width="16" height="16"> Note Station | NoteStation | OK |
| <img src="/images/icons/PDFViewer_64.png" width="16" height="16"> PDF Viewer | PDFViewer | OK |
| <img src="/images/icons/Perl_64.png" width="16" height="16"> Perl | Perl | OK |
| <img src="/images/icons/PHP_64.png" width="16" height="16"> PHP | PHP#.# | OK |
| <img src="/images/icons/plexmediaserver_48.png" width="16" height="16"> Plex Media Server | PlexMediaServer | OK |
| <img src="/images/icons/PrestoServer_64.png" width="16" height="16"> Presto File Server | PrestoServer | OK |
| <img src="/images/icons/ProxyServer_64.png" width="16" height="16"> Proxy Server | ProxyServer | OK |
| <img src="/images/icons/Python_64.png" width="16" height="16"> Python 3.9 | Python3.9 | OK |
| <img src="/images/icons/bb-qq_64.png" width="16" height="16"> RTL8152/RTL8153 driver | r8152 | OK - 3rd party package [link](https://github.com/bb-qq/r8152) |
| <img src="/images/icons/RadiusServer_64.png" width="16" height="16"> RADIUS Server | RadiusServer | OK |
| <img src="/images/icons/SynoSmisProvider_64.png" width="16" height="16"> SMI-S Provider | SynoSmisProvider | OK |
| <img src="/images/icons/SnapshotReplication_64.png" width="16" height="16"> Snapshot Replication | SnapshotReplication | OK |
| <img src="/images/icons/SSOServer_64.png" width="16" height="16"> SSO Server | SSOServer | OK |
| <img src="/images/icons/StorageAnalyzer_64.png" width="16" height="16"> Storage Analyzer | StorageAnalyzer | OK |
| <img src="/images/icons/SurveillanceStation_64.png" width="16" height="16"> Surveillance Station | SurveillanceStation | OK |
| <img src="/images/icons/synocli_72.png" width="16" height="16"> SynoCli Tools | synocli-"toolname" | OK - community package |
| <img src="/images/icons/AIConsole_64.png" width="18" height="18"> Synology AI Console | AIConsole | OK |
| <img src="/images/icons/SynologyApplicationService_64.png" width="16" height="16"> Synology Application Service | SynologyApplicationService | OK |
| <img src="/images/icons/Calendar_64.png" width="16" height="16"> Synology Calendar | Calendar | OK |
| <img src="/images/icons/Chat_64.png" width="16" height="16"> Synology Chat Server | Chat | OK |
| <img src="/images/icons/Contacts_64.png" width="16" height="16"> Synology Contacts | Contacts | OK |
| <img src="/images/icons/DirectoryServerForWindowsDomain_64.png" width="16" height="16"> Synology Directory Server | DirectoryServerForWindowsDomain | OK |
| <img src="/images/icons/SynologyDrive_64.png" width="16" height="16"> Synology Drive Server | SynologyDrive | OK - see [Synology Drive and Btrfs Snapshots](https://github.com/007revad/Synology_app_mover#synology-drive-and-btrfs-snapshots) |
| <img src="/images/icons/MailServer_64.png" width="16" height="16"> Synology Mail Server | MailServer | OK |
| <img src="/images/icons/MailClient_64.png" width="16" height="16"> Synology MailPlus | MailPlus | OK |
| <img src="/images/icons/MailPlus-Server_64.png" width="16" height="16"> Synology MailPlus Server | MailPlus-Server | OK I think |
| <img src="/images/icons/Spreadsheet_64.png" width="16" height="16"> Synology Office | Spreadsheet | OK |
| <img src="/images/icons/photos_64.png" width="16" height="16"> Synology Photos | SynologyPhotos | OK |
| <img src="/images/icons/Tailscale_64.png" width="16" height="16"> Tailscale | Tailscale | OK |
| <img src="/images/icons/TextEditor_64.png" width="16" height="16"> Text Editor | TextEditor | OK |
| <img src="/images/icons/UniversalViewer_64.png" width="16" height="16"> Universal Viewer | UniversalViewer | OK |
| <img src="/images/icons/USBCopy_64.png" width="18" height="18"> USB Copy | USBCopy | see [moving_extras](moving_extras.md)
| <img src="/images/icons/VideoStation_64.png" width="16" height="16"> Video Station | VideoStation | OK |
| <img src="/images/icons/VirtualManagement_64.png" width="16" height="16"> Virtual Machine Manager | Virtualization | OK |
| <img src="/images/icons/VPNCenter_64.png" width="16" height="16"> VPN Server | VPNCenter | OK |
| <img src="/images/icons/WebStation_64.png" width="16" height="16"> Web Station | WebStation | OK |
| <img src="/images/icons/WebDAVServer_64.png" width="16" height="16"> WebDAV Server | WebDAVServer | OK |

</details>

#### Packages not tested

<details>
  <summary>Click here to see list</summary>

<img src="/images/icons/.png" width="16" height="16"> 

The icons in this table are [Copyright © 2004-2026 Synology Inc.](https://kb.synology.com/en-br/DSM/help/DSM/Home/about?version=7) or Copyright the 3rd party package developer.

| Package | Result / Notes |
|---------|--------|
| <img src="/images/icons/ArchiwareP5_64.png" width="16" height="16"> Archiware P5 |  |
| <img src="/images/icons/Sony_BraviaSignage_64.png" width="16" height="16"> BRAVIA Signage | Won't install in Container Manager. It checks if Docker is installed |
| <img src="/images/icons/DdbBackup_64.png" width="18" height="18"> Data Deposit Box |  |
| <img src="/images/icons/diagnosis_64.png" width="20" height="20"> Diagnosis Tool |  |
| <img src="/images/icons/domotz_64.png" width="16" height="16"> Domotz Network Monitoring |  |
| <img src="/images/icons/elephantdrive_64.png" width="16" height="16"> ElephantDrive |  |
| <img src="/images/icons/gateone-64.png" width="16" height="16"> GateOne |  |
| <img src="/images/icons/GoodSync_64.png" width="16" height="16"> GoodSync |  |
| <img src="/images/icons/iDrive_72.png" width="16" height="16"> IDrive |  |
| <img src="/images/icons/jackett-64.png" width="16" height="16"> Jackett | community package |
| <img src="/images/icons/Joomla_64.png" width="16" height="16"> Joomla |  |
| <img src="/images/icons/KodExplorer_64.png" width="16" height="16"> KodiExplorer |  |
| <img src="/images/icons/MediaWiki_72.png" width="18" height="18"> MediaWiki |  |
| <img src="/images/icons/medusa-64.png" width="18" height="18"> Medusa | community package [link](https://github.com/BenjV/SYNO-packages) |
| <img src="/images/icons/MEGAcmd_64.png" width="16" height="16"> MEGAcmd |  |
| <img src="/images/icons/mono_64.png" width="18" height="18"> Mono | community package |
| <img src="/images/icons/NBR_64.png" width="16" height="16"> NAKIVO Backup and Replication |  |
| <img src="/images/icons/NBR-Transporter_64.png" width="16" height="16"> NAKIVO Transporter |  |
| <img src="/images/icons/PACS_64.png" width="16" height="16"> PACS |  |
| <img src="/images/icons/PhotoStation_64.png" width="18" height="18"> Photo Station | DSM 6 |
| <img src="/images/icons/radarr-64.png" width="20" height="20"> Radarr | community package |
| <img src="/images/icons/RagicBuilder_64.png" width="20" height="20"> Ragic Cloud DB |  |
| <img src="/images/icons/resiliosync-48.png" width="16" height="16"> Resilo Sync |  |
| <img src="/images/icons/shellinabox-48.png" width="16" height="16"> Shellinabox | community package |
| <img src="/images/icons/Sonarr_64.png" width="18" height="18"> Sonarr | community package |
| <img src="/images/icons/syncthing-64.png" width="18" height="18"> Syncthing |  |
| <img src="/images/icons/TeamViewer_64.png" width="16" height="16"> TeamViewer |  |
| <img src="/images/icons/transmission-64.png" width="20" height="20"> Transmission | community package |
| <img src="/images/icons/tvheadend-64.png" width="20" height="20"> Tvheadend | community package |
| <img src="/images/icons/VirtualHere_64.png" width="18" height="18"> VirtualHere |  |
| <img src="/images/icons/vtigerCRM_64.png" width="16" height="16"> vtigerCRM |  |
| <img src="/images/icons/WebTools-48.png" width="20" height="20"> WebTools | community package |
| <img src="/images/icons/Wordpress_64.png" width="16" height="16"> Wordpress |  |

</details>

### How to install the package

There are 2 ways to install the package:

**Directly from Package Center**

1. Add [007revad Synology Package Source](https://github.com/007revad/Synology_package_source) to package Center.
2. Click on the Community section in Package Center and install the package.

<p align="center"><kbd><img src="/images/pkg_center.png"></kbd></p>

**Or download the package and install it manually**
1. Download the latest version .spk file from https://github.com/007revad/Syno_App_Mover/releases and save it to your Synology.
2. In Package Center click on Manual Install.
3. Browse to where you downloaded the .spk file.
4. Select the .spk file and click Next.

### Synology Drive and Btrfs Snapshots

Synology Drive handles file versioning differently based on the underlying file system.

- For **ext4 volumes**, the versioning data is stored in the internal folder (`/volume1/@synologydrive/@sync/repo`).
- For **Btrfs volumes**, versioning is managed through **Btrfs snapshots** (see the [Reddit thread here](https://www.reddit.com/r/synology/comments/82o4pv/comment/dvbskzh/)).

When moving Synology Drive’s database from an **ext4** volume to a **Btrfs** volume, the `@sync/repo` folder containing file versioning data **will not be moved** to the Btrfs volume.
This is because **Btrfs snapshots** handle versioning on the Btrfs side, while ext4 relies on the `@synologydrive` folder for versioning.

However, it seems that you won’t lose your file version history as long as you don’t delete the ext4 volume.
The file versions appear to remain intact on the ext4 volume, and you should be able to access them as long as the volume is still available.

But, removing the ext4 volume will result in the **irreversible loss of all file versions**, as the versioning data is stored exclusively in the `@synologydrive` folder on ext4 volumes.

On the positive side, by moving the database to the Btrfs volume, you'll free up the space previously occupied by the versioning data on the ext4 volume.

For more details, see this [GitHub discussion](https://github.com/007revad/Synology_app_mover/discussions/200).

### Screenshots

<!--- <p align="center">Description of image 1 goes here</p> --->
<p align="center"><kbd><img src="/images/installed.png"></kbd></p>

<br>

<p align="center">Settings window</p>
<p align="center"><kbd><img src="/images/settings.png"></kbd></p>

<br>

<p align="center">Moving a package that has a volume location setting</p>
<p align="center"><kbd><img src="/images/installed.png"></kbd></p>

<br>

<p align="center">Moving Active Backup for Business</p>
<p align="center"><kbd><img src="/images/move_abb.png"></kbd></p>

<br>

<p align="center">Backing up Audio Station</p>
<p align="center"><kbd><img src="/images/backup_audiostation.png"></kbd></p>

<br>

<p align="center">Backing up all packages</p>
<p align="center"><kbd><img src="/images/backup_all.png"></kbd></p>

<br>

### Credits
- wallacebrf for extensive beta testing of syno_app_mover v3.
- ctrlaltdelete for the code to export Container Manager/Docker container's settings.
