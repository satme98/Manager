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
4. Relancez `.\pocketbase.exe serve --http=0.0.0.0:8090 --dir=./pb_data --migrationsDir=./pb_migrations --hooksDir=./pb_hooks`.

---

## 8. Guide Utilisateur (1 page — Équipe Économat & Cuisine)

### 8.1 Enregistrer une Entrée de stock (Réception fournisseur)
1. Cliquez sur **Entrées de stock** dans le menu de gauche (ou **+ Saisie rapide > Nouvelle entrée** en haut à droite).
2. Vérifiez la **Date** (pré-remplie à aujourd'hui), choisissez le **Fournisseur**, saisissez le **N° de facture / bon de livraison** et le statut **Payé / Impayé**.
3. Dans le tableau des lignes, recherchez chaque produit par nom ou référence, saisissez la **Quantité reçue** et le **Prix unitaire (DH)** (pré-rempli avec le dernier prix d'achat connu).
4. Cliquez sur **Enregistrer l'entrée** (ou `Ctrl + Entrée`). Le stock actuel et le prix moyen pondéré (PMP) sont mis à jour instantanément.

### 8.2 Enregistrer une Sortie de stock (Consommation quotidienne)
1. Cliquez sur **Sorties de stock** > **Nouvelle sortie** (adapté aux tablettes en cuisine).
2. Choisissez la **Destination** (*Cuisine chaude*, *Cuisine froide*, *Bar*, *Pâtisserie*, etc.).
3. Sélectionnez le produit : le **stock disponible** s'affiche immédiatement. Saisissez la **Quantité sortie**.
4. Cliquez sur **Enregistrer la sortie**. *(Note : si la quantité dépasse le stock disponible, l'application bloque la saisie pour l'Économat et la Cuisine ; seul un Manager peut autoriser un stock négatif avec un motif obligatoire).*

### 8.3 Déclarer une Perte ou du Gaspillage (Casse, Péremption)
1. Allez dans **Pertes & Gaspillage** > **Enregistrer une perte** (ou dans un bon de **Sortie de stock**, colonne **Pertes**).
2. Saisissez la quantité perdue et choisissez le **Motif de perte** (*Casse*, *Péremption*, *Altération*, *Erreur de préparation*).
3. La perte est déduite du stock et valorisée automatiquement au coût moyen (PMP) du moment.

### 8.4 Réaliser un Inventaire physique
1. Allez dans **Inventaires** > **Nouvel inventaire**. Choisissez **Inventaire complet** ou **Par catégorie / emplacement**.
2. Cliquez sur **Imprimer la fiche de comptage** si vous comptez sur papier en chambre froide/réserve.
3. Saisissez les quantités dans la colonne **Stock compté**. Utilisez **Enregistrer le brouillon** à tout moment : **tant que l'inventaire est en brouillon, le stock officiel ne change pas**.
4. Une fois le comptage vérifié, un **Manager** ou **Administrateur** clique sur **Confirmer l'inventaire** : le stock compté devient la nouvelle base officielle uniquement pour les articles comptés.

### 8.5 Corriger une erreur de saisie (Contre-passation)
- **Règle d'or : on ne supprime jamais un mouvement validé.**
- Ouvrez le bon d'entrée ou de sortie concerné, cliquez sur **Corriger / Annuler**, et indiquez le **motif obligatoire** :
  - **Annuler** crée une écriture inverse (`REV-...`) qui remet le stock exactement dans son état initial.
  - **Corriger et recréer** annule le bon erroné et ouvre immédiatement un nouveau formulaire pré-rempli avec vos lignes pour corriger la quantité ou le prix.

---

## 9. Guide Administrateur (Sécurité, Sauvegardes, Mises à jour & Continuité)

### 9.1 Gestion des utilisateurs et des 5 rôles (`/utilisateurs`)
- **Administrateur (`admin`)** : accès complet, gestion des comptes utilisateurs, paramètres et restauration.
- **Manager (`manager`)** : toutes les opérations, validation des inventaires, autorisation de stock négatif et approbation des contre-passations.
- **Économat (`economat`)** : saisie des produits, fournisseurs, entrées, sorties et brouillons d'inventaire.
- **Cuisine (`cuisine`)** : consultation des quantités en stock et saisie des sorties/pertes uniquement. **Aucun prix, aucune valeur en DH, aucun fournisseur et aucun paiement ne sont visibles ni transmis par l'API.**
- **Consultation (`consultation`)** : lecture seule sur tous les tableaux de bord et rapports (idéal pour la direction ou le comptable).
- *Départ d'un employé* : ne supprimez jamais un compte (pour conserver l'historique des saisies) ; basculez son statut sur **Inactif** dans **Utilisateurs**.

### 9.2 Stratégie de sauvegarde (Règle 3-2-1)
1. **Automatique chaque nuit (03h00)** via `scripts\backup.bat` vers un second disque ou clé USB dédiée (conservation des 14 derniers jours).
2. **Manuelle avant toute opération sensible** via **Paramètres > Sauvegarde & Restauration > Télécharger une sauvegarde maintenant** (`.json`) et **Import / Export > Exporter toutes les données (`.xlsx`)**.

### 9.3 Mettre à jour PocketBase en toute sécurité
- **Ne jamais activer de mise à jour automatique.**
- Procédure :
  1. Lisez les notes de version (*Changelog*) de PocketBase pour vérifier la compatibilité avec `pb_migrations/` et `pb_hooks/`.
  2. Arrêtez PocketBase et lancez `scripts\backup.bat` pour sauvegarder `pb_data`.
  3. Testez le nouveau binaire `pocketbase.exe` sur une copie du dossier avant de remplacer l'exécutable de production.

### 9.4 Que faire si le PC principal tombe en panne ?
1. Sur n'importe quel autre PC Windows du restaurant, installez le dossier de l'application et `pocketbase.exe` (`v0.25.2`).
2. Copiez le dernier dossier `pb_data_YYYYMMDD` depuis votre clé USB de sauvegarde vers `pb_data` (ou restaurez le dernier fichier `.json` depuis **Paramètres > Restaurer une sauvegarde**).
3. Attribuez la même adresse IP fixe (`192.168.1.50`) à ce PC de secours et lancez `.\pocketbase.exe serve --http=0.0.0.0:8090`. Le restaurant retrouve l'intégralité de ses données en moins de 10 minutes.

---

## 10. Checklist de Mise en Service (Go-Live)

- [ ] **1. Import final nettoyé** : Exécuter l'assistant **Import / Export** avec la dernière version du fichier `MONARQ_ECONOMAT.xlsm` et vérifier que le rapport de réconciliation affiche `0,00 DH` d'écart.
- [ ] **2. Traitement de la liste « À corriger »** : Ouvrir l'onglet **Import / Export > À corriger — Qualité des données**, affecter une catégorie aux produits sans catégorie et renseigner les prix manquants.
- [ ] **3. Définition des seuils minimums** : Dans **Réapprovisionnement > À définir**, saisir les seuils minimums des produits critiques pour activer les alertes de rupture.
- [ ] **4. Inventaire d'ouverture validé** : Faire un comptage physique de contrôle au démarrage et confirmer la session d'inventaire.
- [ ] **5. Création des comptes nominatifs** : Créer un compte par employé dans **Utilisateurs** avec son rôle exact (`manager`, `economat`, `cuisine`, `consultation`).
- [ ] **6. Test de sauvegarde et restauration** : Générer une sauvegarde `.json` et exécuter `scripts\backup.bat`, puis vérifier que le fichier se restaure sans erreur.
- [ ] **7. Bascule officielle (Cut-over)** : Fixer la date et l'heure de bascule (ex. lundi matin après l'inventaire) et **archiver définitivement le fichier Excel en lecture seule** pour que 100 % des nouvelles entrées et sorties soient saisies dans **MONARQ ÉCONOMAT**.

