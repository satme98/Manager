# MONARQ ÉCONOMAT — Guide d'installation Windows (Réseau Local Wi-Fi & PocketBase)

Ce guide explique comment installer, sécuriser et exploiter **MONARQ ÉCONOMAT** sur le PC principal du restaurant sous Windows, afin que les tablettes et postes du même réseau Wi-Fi puissent y accéder en temps réel.

---

## 1. Version de PocketBase épinglée

- **Version requise** : **PocketBase `v0.25.2`** (binaire unique Windows `pocketbase_0.25.2_windows_amd64.zip`).
- Syntaxe utilisée : PocketBase v0.25+ (`fields` au lieu de l'ancien `schema`, super-utilisateurs système dans `_superusers`).
- Placez l'exécutable `pocketbase.exe` à la racine du projet (au même niveau que `pb_migrations/` et `pb_hooks/`).

---

## 2. Configurer une adresse IP locale fixe sur le PC serveur

Pour que l'adresse du serveur ne change pas après un redémarrage de la box Wi-Fi :

1. Ouvrez **Paramètres Windows** > **Réseau et Internet** > **Wi-Fi** (ou **Ethernet**) > **Propriétés du matériel**.
2. En face de **Attribution de l'adresse IP**, cliquez sur **Modifier** et sélectionnez **Manuel** > **IPv4**.
3. Saisissez par exemple :
   - **Adresse IP** : `192.168.1.50`
   - **Masque de sous-réseau** : `255.255.255.0`
   - **Passerelle par défaut** : `192.168.1.1` (adresse de votre routeur)
   - **DNS préféré** : `1.1.1.1` ou `8.8.8.8`
4. Enregistrez. Notez cette adresse IP (`192.168.1.50`).

---

## 3. Désactiver la mise en veille du PC serveur

Le PC qui héberge PocketBase ne doit pas se mettre en veille pendant le service :

1. Ouvrez **Paramètres Windows** > **Système** > **Alimentation et batterie** (ou **Alimentation et mise en veille**).
2. Réglez **Mise en veille sur secteur** sur **Jamais**.
3. Vous pouvez laisser l'extinction de l'écran sur 15 ou 30 minutes (cela ne coupe pas PocketBase).

---

## 4. Ouvrir le port dans le Pare-feu Windows

Ouvrez **PowerShell en tant qu'Administrateur** et exécutez :

```powershell
New-NetFirewallRule -DisplayName "MONARQ PocketBase (8090)" -Direction Inbound -LocalPort 8090 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "MONARQ Web UI (3000)" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
```

*(Important : Assurez-vous que votre réseau Wi-Fi est défini en profil **Privé** dans Windows et non Public).*

---

## 5. Initialiser la base et créer le premier compte Administrateur (sans mot de passe en dur)

Aucun mot de passe de production n'est codé en dur dans l'application. Pour initialiser le serveur :

### Étape 5.1 — Appliquer les migrations (`pb_migrations/`)
Depuis un terminal à la racine du projet :

```powershell
.\pocketbase.exe migrate up
```

Cette commande crée et vérifie les 12 collections (`products`, `suppliers`, `purchases`, `purchase_lines`, `exits`, `exit_lines`, `inventory_sessions`, `inventory_lines`, `audit_log`, `settings`, `import_batches`, et étend `users`).

### Étape 5.2 — Créer le super-utilisateur système PocketBase (`_superusers`)

```powershell
.\pocketbase.exe superuser upsert direction@monarq.ma "<VOTRE_MOT_DE_PASSE_SUPERUSER_FORT>"
```

### Étape 5.3 — Créer le premier utilisateur applicatif (`users`, rôle `admin`)

Démarrez PocketBase (voir section 6), puis créez votre premier utilisateur applicatif `admin` soit via la console PocketBase (`http://127.0.0.1:8090/_/` > collection `users`), soit en une commande PowerShell via l'API :

```powershell
# 1. Authentification superuser pour obtenir un jeton temporaire
$superAuth = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8090/api/collections/_superusers/auth-with-password" `
  -ContentType "application/json" `
  -Body '{"identity":"direction@monarq.ma","password":"<VOTRE_MOT_DE_PASSE_SUPERUSER_FORT>"}'

# 2. Création du premier compte applicatif Admin dans la collection "users"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8090/api/collections/users/records" `
  -Headers @{ Authorization = "Bearer $($superAuth.token)" } `
  -ContentType "application/json" `
  -Body '{"email":"admin@monarq.ma","password":"<VOTRE_MOT_DE_PASSE_ADMIN>","passwordConfirm":"<VOTRE_MOT_DE_PASSE_ADMIN>","name":"Administrateur MONARQ","role":"admin","active":true,"verified":true}'
```

Une fois connecté à MONARQ ÉCONOMAT avec ce compte `admin`, rendez-vous dans **SYSTÈME > Utilisateurs** (`/utilisateurs`) pour créer les comptes de votre équipe (`manager`, `economat`, `cuisine`, `consultation`).

---

## 6. Démarrer PocketBase et l'application MONARQ ÉCONOMAT

### Configurer le fichier `.env`
Créez un fichier `.env` à la racine du projet :

```env
VITE_DATA_ADAPTER=pocketbase
VITE_POCKETBASE_URL=http://192.168.1.50:8090
```

### Lancer PocketBase sur le réseau local
```powershell
.\pocketbase.exe serve --http=0.0.0.0:8090 --dir=./pb_data --migrationsDir=./pb_migrations --hooksDir=./pb_hooks
```

### Compiler et servir l'interface Web (ou l'intégrer dans `pb_public`)
Option A — Servir directement depuis PocketBase (1 seul processus) :
```powershell
npm run build
robocopy dist pb_public /MIR
```
Toutes les tablettes du restaurant accèdent alors à **`http://192.168.1.50:8090`**.

Option B — Lancer le serveur Web sur le port 3000 :
```powershell
npm run dev
```

---

## 7. Sauvegarde automatique nocturne et restauration

### Sauvegarde automatique (Planificateur de tâches Windows)
Le script `scripts\backup.bat` copie l'intégralité du dossier `pb_data` vers `pb_backups\pb_data_YYYYMMDD_HHMMSS` (ou vers une clé USB passée en paramètre, ex. `E:\MONARQ_BACKUPS`) et conserve automatiquement les **14 dernières sauvegardes**.

Pour planifier l'exécution tous les soirs à 03h00 :
```powershell
schtasks /Create /SC DAILY /TN "MONARQ_Economat_Backup" /TR "C:\monarq\scripts\backup.bat D:\MONARQ_Backups" /ST 03:00 /F
```

### Sauvegarde manuelle depuis l'application
À tout moment, un utilisateur peut cliquer sur **« Exporter une sauvegarde »** dans **SYSTÈME > Paramètres** (`/parametres`) ou **SYSTÈME > Import / Export** (`/import-export`) pour télécharger immédiatement une archive JSON horodatée de toutes les collections.

### Restaurer une sauvegarde `pb_data`
1. Arrêtez le processus `pocketbase.exe` (`Ctrl + C`).
2. Renommez le dossier actuel `pb_data` en `pb_data_avant_restauration`.
3. Copiez le dossier de sauvegarde souhaité (ex. `pb_backups\pb_data_20250512_030000`) vers `pb_data`.
4. Relancez `.\pocketbase.exe serve --http=0.0.0.0:8090`.
