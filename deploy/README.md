# lama, server procedures

This document is for the technician (administrator account). The server is a mini PC running Ubuntu Server 24.04, kept in the institute and wired to the Wi-Fi router. The team opens the application at https://lama.local from any device on the Wi-Fi, once the institute's certificate is approved on that device (see "HTTPS certificate"). French version: [LISEZMOI.md](LISEZMOI.md).

## Script language

The scripts speak the language of the terminal: English when the `LANG` variable starts with `en`, French otherwise (`sudo` keeps `LANG` on Ubuntu). To force it, put it before the command, for example `sudo LAMA_LANGUE=en ./deploy/installer.sh` or `sudo LAMA_LANGUE=fr ./deploy/installer.sh`. The words to type to confirm follow the language: `YES` and `ERASE` in English, `OUI` and `EFFACER` in French.

The application itself follows the language of each account: everyone chooses it with the FR / EN button at the bottom of the side menu, or in Settings, My account.

## Install

1. Install Ubuntu Server 24.04, or Ubuntu 24.04 or 26.04 desktop, on the mini PC (maintenance account of your choice, SSH enabled: on desktop, `sudo apt install openssh-server`). Connect it to the router with a cable. On desktop, the installation turns sleep off.
2. **In one command, from the public repository** (the mini PC needs internet access). On the server, in a terminal (an interactive SSH session is fine):

```bash
curl -fsSL https://raw.githubusercontent.com/maebaconsulting/lama/main/deploy/installer-en-ligne.sh -o installer-en-ligne.sh
sudo bash installer-en-ligne.sh
```

   The script installs Git and Node 24, downloads the repository, builds the package, then runs `deploy/installer.sh` from the extracted folder, kept in `/var/lib/lama-installation`. To pick the mode up front: `sudo bash installer-en-ligne.sh --auto` or `--assiste`. Do not pipe the script into sudo (`curl … | sudo bash`): on Ubuntu 26.04 the keyboard no longer reaches it, and the script refuses it. Then go straight to step 4.

   **Or, from an archive.** On the development computer, build the archive with `pnpm paquet`, then copy it to the server (`scp paquets/lama-….tar.gz technicien@address:`).
3. On the server, in a terminal (an interactive SSH session is fine):

```bash
tar -xzf lama-*.tar.gz
cd lama-*/
sudo ./deploy/installer.sh
```

When it starts, the script offers two modes:

- **Automatic** (`sudo ./deploy/installer.sh --auto`): default settings, no questions. Time zone Africa/Douala, WhatsApp installed, sleep turned off on Ubuntu desktop, backup drive used only if already prepared, training database and Google Drive left for later.
- **Assisted** (`sudo ./deploy/installer.sh --assiste`): one question for each choice (language, time zone, exact time, sleep, preparing a new USB drive, WhatsApp, training database, Google Drive). The default answer is in square brackets; Enter alone takes it.

In both modes, the installation stops on the recovery keys and waits for YES.

The installation must run in a real terminal: the script refuses to go on otherwise, because the recovery keys (see below) are shown on screen only, once.

4. The script first installs the system packages (Node 24, age, rclone, avahi, openssl, polkit, systemd-timesyncd) and creates the `lama` service account. It then shows the recovery keys and waits for the YES confirmation before writing anything to disk: only after that confirmation does it install the program in `/opt/lama`, make the HTTPS certificate for `lama.local` and the server's current IP address (see "HTTPS certificate"), prepare the backup drive if it is plugged in, then install and start the services. The server clock must be right before the installation: check it with `date`, and correct it if needed with `sudo timedatectl set-time 'YYYY-MM-DD HH:MM:SS'`.
5. From a device on the Wi-Fi, open http://lama.local/certificat, approve the certificate, then open https://lama.local: the setup screen creates the administrator account, in the language shown on that screen, and chooses the currency; it stays editable in Settings, Checkout, Currency section, until the first sale. Sign in, then create the manager's account in Settings, Team and accounts. The manager then enters the institute's name in Settings, Institute: it heads the receipts and the till closings (left empty, it is not printed).

The script can safely be run again with the same version, from an archive freshly extracted somewhere other than `/opt/lama`: it keeps the data, keys and settings already in place, and shows no new keys. With an archive of another version, it refuses and points to `mettre-a-jour.sh` (see "Update"), which backs up first and goes back if anything fails. It also refuses to run from `/opt/lama` itself; copy the archive elsewhere before running it again.

## Recovery keys

The installation shows two keys, only once, before installing the program and the services: nothing is saved until YES has been typed. Print them or copy them, then keep them outside the institute. After YES, the script clears the screen and its scrollback; if the terminal or the SSH software records the session (log, saved scrollback), clear that record as well.

- The master key encrypts the secrets of the settings (WhatsApp and payment tokens). It also stays on the server, in `/etc/lama/master.key`.
- The backup private key is the only one able to read a backup. It is never written on the server: someone who steals the mini PC or the USB drive cannot read anything.

Without the private key, no backup can be restored. If the installation is stopped before YES was typed, nothing was saved: run the script again, which will show new keys, and throw away the ones just shown.

## HTTPS certificate

lama serves the application over https with a certificate of the institute's own. The installation makes a certificate authority (valid for 10 years, private key in `/etc/lama/tls/autorite.key`, readable by root only) and the server certificate for `lama.local` and the fixed IP address (valid for 397 days). The authority is only valid for `lama.local` and local network addresses: even if copied, it cannot impersonate any other site.

1. Reserve the server's IP address in the router, as shown by the installation: it is written in the certificate.
2. On each device (tablet, phone, computer), open http://lama.local/certificat (or http://192.168.x.y/certificat). The page recognises the device, offers the right file (a profile for iPhone and iPad, a certificate for Android, Windows and Mac) and gives the steps. Compare the authority fingerprint shown on the device with the one printed by the installer (or given by `sudo lama-certificat --etat` on the server): the authority is distributed over plain http, and only this comparison proves it was not swapped on the way.
3. Tap "Check the secure connection": the page confirms. Then open https://lama.local, and install lama on the device's home screen (see "Install lama on the home screen").

On the server itself (Ubuntu desktop), nothing to do: installation and updates make it trust the authority, for the system and for Firefox (`/etc/firefox/policies/policies.json` rule, completed without being overwritten). A Firefox already open must be restarted once.

Port 80 only serves this page and its files: any other http address is sent on to https. The server certificate renews itself (`lama-certificat.timer` task, on the 1st of each month, when fewer than 90 days are left), without restarting lama and without redoing anything on the devices.

Devices switching to https keep their session and their declaration only within 30 days after the first https start: after that, sign in again and declare the device again.

- Server IP address changed: `sudo lama-certificat --adresse 192.168.1.60` (same authority, nothing to redo on the devices).
- Status: `sudo lama-certificat --etat`. Immediate renewal: `sudo lama-certificat --renouveler --forcer` (for example after correcting a clock that was wrong at installation time).
- Without a readable certificate, lama starts on http only and its log says so (`journalctl -u lama -n 50`).

## Install lama on the home screen

Once the certificate is approved, install lama on the home screen of every tablet and phone of the institute: it then opens full screen, without the browser bar, and starts faster. With the server off, it still opens and says "Server unreachable"; nothing is entered or saved offline.

- iPhone and iPad: in Safari, open https://lama.local, tap "Share" (the square with an arrow pointing up), then "Add to Home Screen", then "Add".
- Android: in Chrome, open https://lama.local, then tap "Install" in lama's banner (or, in Chrome's menu, "Install app").
- Computer (Chrome or Edge): install icon at the end of the address bar.

On iPhone and iPad, the installed app keeps its own sign-in, separate from Safari: sign in again there, and a shared device declared in Safari must be declared again in the installed app.

In lama, the "Install lama on this device" entry (in the rail, or in "More" on a phone) does the same, for every role; it disappears once lama is installed, and is not offered until the certificate is approved.

After a server update, lama shows "New version available: Reload": tap "Reload" when nothing is being entered. Otherwise, the new version is taken at the next launch.

## Server time

The server time dates invoices, credit notes and receipts. `systemd-timesyncd` sets it by itself whenever internet is available. The administrator's and the manager's screens report a difference of more than 2 minutes with the device. The administrator corrects it in Settings, Time (password required): "Set the server to this device's time", or a time entered by hand. If the server time is more than one minute earlier than the last invoice, sales, credit notes and deposits are refused until it is corrected.

The rule `/etc/polkit-1/rules.d/50-lama-heure.rules`, put in place by the installation, allows this setting to the `lama` account, and to it only. Without it, the screen says the permission is missing: run `sudo ./deploy/installer.sh` again, or set the time with `sudo timedatectl set-time 'YYYY-MM-DD HH:MM:SS'`.

## Backup drive

A dedicated USB drive receives an encrypted backup every night at 2 am: 30 daily and 12 monthly backups.

To prepare it (the drive is erased):

```bash
lsblk                      # find the USB drive, for example /dev/sdb
sudo /opt/lama/actuelle/deploy/preparer-disque.sh /dev/sdb
```

The script refuses any drive that holds the system (including a volume managed by LVM or an encrypted disk), any partition given instead of a whole disk, and stops as a precaution if the system disk could not be identified; it then asks you to type ERASE (EFFACER in French). The drive is then mounted by itself each time it is plugged in. If it is unplugged on the night of the backup, the failure is recorded, a warning banner appears after 36 hours, and the copy to Google Drive still leaves.

## Google Drive

A copy of each backup goes to Google Drive, with automatic retries while the internet is down. Daily backups less than 15 days old and monthly backups less than 366 days old are kept there; older ones are removed automatically.

1. On the server:

```bash
sudo /opt/lama/actuelle/deploy/configurer-drive.sh
```

2. Follow the instructions: on a computer that has a browser and rclone, run `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"` (access limited to the files created by the application), sign in with the institute's Google account, then paste on the server the whole block of text shown between the two lines of arrows (it is not shown while you type). The script checks the authorisation with Google; if it is refused, run it again and redo `rclone authorize`.
3. In the application, Settings, Connections: save the destination `gdrive:lama`.

## WhatsApp

The installation also sets up the WAHA WhatsApp gateway: Ubuntu's Docker, then a `lama-waha` container (GOWS engine) reachable only from the server (127.0.0.1, port 3000), restarted automatically, with the phone session kept in the `lama-waha-sessions` volume. Its key is created in `/etc/lama/waha.env` (readable by root only), kept from one installation to the next and saved in the application settings. The WAHA version is the one in `deploy/waha.version` in the archive: `mettre-a-jour.sh` moves to the version of the new archive, once that archive is running.

1. In the application, Settings, WhatsApp: choose WAHA as the provider.
2. Scan the QR code with the institute's phone (WhatsApp, Linked devices).

If the WhatsApp step fails (no internet, image not found), the application keeps running without automatic sending: fix the problem, then run `sudo ./deploy/installer.sh` again from the folder of the running version. Container state: `sudo docker ps`, log: `sudo docker logs lama-waha`.

## Receipt printer

lama prints receipts directly on an 80 mm thermal printer connected to the institute's network (ESC/POS, port 9100), for example a NETUM NS-8360LW.

1. Connect the printer to the router with a network cable. To find its address, turn it on while holding the FEED button: it prints its configuration page.
2. In the router, reserve this address for the printer (DHCP reservation), so that it does not change.
3. In the application, Settings, Checkout, "Receipt printer" block: enter the address, save, then "Print a test".

The cash drawer plugs into the printer; it only opens with the "Open the drawer" button of the Daily till screen.

## SMS gateway phone

lama sends SMS through an Android phone of the institute (Android 5.0 or later), running the free SMS Gateway for Android application. The phone sends over the mobile network: SMS go out even without internet.

1. A dedicated phone, with a SIM card that has an SMS plan. Keep it plugged into its charger at all times.
2. Install the SMS Gateway for Android application (https://github.com/capcom6/android-sms-gateway, or its Play Store page) and allow it to send SMS.
3. In the application, turn on the "Local server" and note the address it shows (for example 192.168.1.60:8080), the username and the password.
4. In the router, reserve this IP address for the phone, so that it does not change.
5. In Android's settings, exclude the application from battery optimization (otherwise Android puts it to sleep and SMS stop going out).
6. In lama, as administrator: Settings, Connections, SMS block. Choose "Institute's Android phone", enter the address, the username and the password, then save. The status must read "Gateway reachable".
7. Send a test SMS to your own number.

If the status reads "Gateway unreachable": phone switched off, application stopped or asleep, or address changed. If it reads "Username or password refused": enter the ones from the application again.

## Training database

An optional practice database on the same mini-PC: same program, same certificate, port 8443, separate data (`/var/lib/lama-formation`). People learn there without risk: nothing leaves it (no WhatsApp message or SMS, no backup, the server time is never set), every screen shows the blue "Training database" banner and every receipt, paper or PDF, shows "TRAINING" ("FORMATION" on a French receipt). In Settings, the Time and Backups sections and the WhatsApp session show "Disabled in the training database". The institute's printer stays allowed.

1. Install lama first (previous sections, certificate included), then run the first command below. It asks for the passwords of the four training accounts, twice each, at least 10 characters, different from those of the real database: `formation.admin`, `formation.gerante`, `formation.reception` and `formation.praticienne` (linked to Solange Ekambi's record).
2. On each device whose certificate is already approved, open https://lama.local:8443 (or https://192.168.1.50:8443, with the server's fixed address) and sign in with a training account. It can be installed on the home screen next to lama: it is called "lama formation" ("lama training" when the institute works in English).

```bash
sudo /opt/lama/actuelle/deploy/lama-formation.sh --installer   # the first time
sudo lama-formation --etat              # service, address and accounts
sudo lama-formation --comptes           # change the passwords, accounts unlocked
sudo lama-formation --remettre-a-zero   # demonstration recreated from scratch, accounts kept
sudo systemctl disable --now lama-formation   # stop the training database, its data stays
```

If the training sign-in screen shows "No training account", the accounts were not created: run `sudo lama-formation --comptes`.

The training database takes the currency of the real database (with its symbol position and display): `--installer` and `--comptes` read it under the `lama` account, without writing anything there, and the demonstration is seeded in that currency. A training database that already has sales keeps its own.

The reset is also available in the application: account `formation.admin`, Settings, Training, "Reset the training database" (tick the box, then the password is asked again). It takes effect when the service restarts, which systemd does by itself; everyone signs in again. The four training accounts are restored (role, record, name) and the declared devices are kept; everything else, accounts created during a session included (appointments, sales, records, settings), is erased and the "Institut Démo" demonstration comes back, with six months of history. If the command says that no account was kept, run `sudo lama-formation --comptes`. `mettre-a-jour.sh` restarts the training database on the new version; it has no backup and no recovery key, its data is fictitious.

## Update

### From the application

Once the mechanism is set up (installation, or a first update done by hand below on a server installed before), the administrator updates lama without a terminal: Settings, “Updates”, “Check now”, then “Update to X.Y.Z” (tick box, password asked again). The “Automatic at night (3:30 am)” mode does the same every night, with nobody around.

Only versions published and signed by the lama publisher are offered. The `lama-mise-a-jour` service (root, started by the application or by the night timer) downloads the version from GitHub, checks its signature with the key of the running version then its checksums, and runs `mettre-a-jour.sh` from the new version: backup, installation, restart, check and rollback, as by hand. During the restart, every screen shows “Maintenance in progress”. The section shows the current step, then the result and, if it failed, the reason. The service stops by itself after 4 hours at most.

Service log: `journalctl -u lama-mise-a-jour -n 100`. State of the last operation: `/var/lib/lama/mise-a-jour/etat.json`.

Acceptance testing on a test repository only: the root file `/etc/lama/mise-a-jour.conf`, absent normally, points to another GitHub repository with a `DEPOT=owner/name` line; the application and the service both read it.

### By hand

For the first update of a server installed before updates from the application (it sets the mechanism up), for a server without internet, or for a development package.

1. Copy the four files of the version, taken from the lama releases page on GitHub, into one folder on the server: `lama-X.Y.Z.tar.gz`, `NOTES.md`, `SHA256SUMS` and `SHA256SUMS.sig`. Development package: `pnpm paquet` on the development computer, then copy the archive.
2. On the server, in that folder:

Run the update inside `tmux` (or `screen`): if the SSH session drops half-way, the script goes on and you get its output back with `tmux attach`. Install `tmux` once and for all with `sudo apt-get install -y tmux` if it is missing.

```bash
tmux
tar -xzf lama-NOUVELLE.tar.gz
cd lama-NOUVELLE/
sudo ./deploy/mettre-a-jour.sh
```

The script first checks the archive: signature of `SHA256SUMS` by the key of the running version, checksums of the archive and of the notes, then an extracted folder identical to the archive (any symbolic link in that folder is refused). An X.Y.Z version without these files is refused; a development package goes through with a warning. A server installed before signed versions has no key yet: run by hand, the script uses the archive's key and says so with a warning (this detects a damaged archive, not a forged one; comparing its checksum with the one on the releases page only rules out a damaged archive, since it comes from the same source; to rule out a forged archive, get the archive's checksum from the publisher through another channel, phone or message, and compare it with the output of `sha256sum lama-X.Y.Z.tar.gz`); the application's service always refuses in that case, hence this first update by hand. The `--sans-signature` option is for tests only. One update at a time: if another one is running (from the application or another terminal), the script stops and says so.

The script then backs up. If that backup fails only because of the USB drive (missing or failed), the update still goes on, the Google Drive copy staying in the queue. If it fails for any other reason, the update is cancelled: nothing is changed.

It then installs the new version next to the old ones, makes the HTTPS certificate if it is missing (or renews it at the threshold), restarts, and checks that the application responds. Otherwise it goes back to the previous version by itself. If the new version had changed the structure of the database, the copy made before the update is put back automatically on that rollback; the database changed by the new version is kept next to it, under the name `lama.db.migree-AAAAMMJJ-HHMMSS` (with its `-wal` and `-shm` files if any). Only recent versions are kept in `/opt/lama/versions` (the last three installed, plus the running version and the previous one). Last, it sets up updates from the application, if missing.

### First update to HTTPS

The first update of a server installed before HTTPS switches lama to https: from the restart on, each device shows a warning until the institute's certificate is installed on it.

1. Do it outside opening hours, with internet if possible: the script installs `openssl`, `polkitd` and `systemd-timesyncd` if they are missing. Offline, it goes on and says what is missing (without `openssl`, lama stays on http; without `polkitd`, Settings, Time is refused; without `systemd-timesyncd`, the time is not set automatically).
2. At the end of the script, note the address and the authority fingerprint shown.
3. Go to each device (till, front desk, tablets, phones): open http://lama.local/certificat, install the certificate, compare the fingerprint shown on the device with the script's one (see "HTTPS certificate"), then close the lama tabs and open https://lama.local.
4. Do it within 30 days: the devices then keep their session and their declaration; after that, sign in again and declare the device again.

## Restore a backup

From the application (normal case): Settings, Backups, Restore. Choose the backup, paste the private key, confirm with the password. Every screen shows "Maintenance in progress" for about a minute, then the application restarts on the backup. The replaced database is kept under the name avant-restauration-….db.

From the command line, if the application no longer starts (preferably inside `tmux`, as for the update):

```bash
sudo /opt/lama/actuelle/deploy/restaurer.sh --lister
sudo /opt/lama/actuelle/deploy/restaurer.sh /mnt/lama-sauvegarde/quotidiennes/lama-AAAAMMJJ-HHMM.db.gz.age
sudo /opt/lama/actuelle/deploy/restaurer.sh --drive lama-AAAAMMJJ-HHMM.db.gz.age
```

The --drive option reads the destination `gdrive:lama`. If another destination was saved in Settings, Connections, give it like this: `sudo LAMA_DRIVE=gdrive:AutreDossier /opt/lama/actuelle/deploy/restaurer.sh --drive lama-AAAAMMJJ-HHMM.db.gz.age` (same with --lister).

The private key is asked for on the keyboard, without being shown. If it is wrong, nothing is changed. The given file is read by the service account, never as root: a backup copied anywhere other than the backup drive must be put in `/tmp` and made readable (`chmod 0644`, it stays encrypted). The application is always started again at the end, even if the restore is interrupted half-way.

## Recover from a server failure

1. Install Ubuntu Server 24.04 on the new machine.
2. Before running the installation, put the two recovery keys back to keep the same ones:

```bash
sudo install -d -m 0750 /etc/lama
sudo sh -c 'umask 077; cat > /etc/lama/master.key'        # paste the master key, Enter, then Ctrl-D
sudo sh -c 'age-keygen -y > /etc/lama/sauvegarde.pub'     # paste the private key, Enter, then Ctrl-D
```

(install `age` first with `sudo apt-get install -y age` if the command is missing.)

3. Run `sudo ./deploy/installer.sh` from the archive, in a terminal: it keeps these keys and shows no new ones.
4. Plug in the backup drive, then run `sudo ./deploy/installer.sh` again from the same archive: it gives the whole content of the drive back to the service account (the `lama` account always has number 871, but a drive coming from an older installation may belong to another number, and the next backups would fail on it). Then restore the most recent backup from the command line (see above). If the drive is lost, authorise Google Drive, then restore with --drive.
5. Sign in with an account from the backup: they all came back with the data.

## Monitoring

- Service status: `systemctl status lama`
- Logs: `journalctl -u lama -n 100`
- Next backup: `systemctl list-timers lama-sauvegarde.timer`
- Certificate: `sudo lama-certificat --etat`, next check with `systemctl list-timers lama-certificat.timer`
- Immediate backup: `sudo systemctl start lama-sauvegarde.service`
- History and warnings: Settings, Backups, in the application.

If https://lama.local does not respond from a device on the Wi-Fi:

- browser warning: the certificate is not approved on this device, open http://lama.local/certificat;

- try the server's IP address, https://192.168.x.y (given by `hostname -I` on the server, or by the list of devices of the router);
- `lama-2.local` or `lama-3.local` (the certificate does not cover them, use the IP address meanwhile): avahi takes a suffixed name when it believes the name is already taken on the network (another device named `lama`, or announcements of the server itself just before a restart);
- `journalctl -u avahi-daemon | grep conflict` confirms it, and `sudo systemctl restart avahi-daemon` takes the name `lama.local` back once the conflict is gone.

After a power cut, the server restarts and the application starts again by itself; a backup missed at 2 am is made at start-up.
