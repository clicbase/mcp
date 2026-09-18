# Serveur MCP Clicbase (tout-en-un)

Donne à Claude (ou tout client MCP) de quoi **provisionner ET administrer** une base
Clicbase, avec une **clé API** `cbk_…` générée depuis le tableau de bord.

> ⚠️ Cette phrase annonçait « uniquement avec un compte Clicbase (email + mot de
> passe) » jusqu'au 2026-09-17, alors que le code n'accepte plus que la clé
> depuis le 2026-09-13. La section « Pourquoi une clé et pas un mot de passe »,
> plus bas, disait déjà le contraire : personne ne lit la page entière avant de
> se lancer, et une première ligne fausse envoie chercher au mauvais endroit.

Outils :

- `create_database` — crée/récupère une base pour un site (renvoie connexion Postgres + URL REST + clés anon/service).
- `get_credentials` — récupère les identifiants d'un projet existant.
- `run_sql` — exécute du SQL (tables, RLS, policies…) sur un projet.
- `list_tables` — liste les tables d'un projet.
- `enable_realtime` — active le temps réel sur une table.
- `set_oauth_provider` — configure Google OAuth.
- `set_email_smtp` — configure un SMTP (sinon SMTP interne Clicbase par défaut).
- `list_sites` — les sites heberges : c'est ICI qu'on prend le `site_id`.
- `list_projects` — les projets (bases) visibles par la cle.
- `list_site_files` — liste les fichiers d'un site heberge (nom, taille, date).
- `read_site_file` — rend le contenu d'UN fichier, en base64 cote API, decode cote outil.
- `clicbase_conventions` — les regles de la plateforme : policies RLS, droits, PostgREST.
- `list_sftp_accounts` — les comptes SFTP dedies d'un site (noms, jamais de mot de passe).
- `create_sftp_account` — cree un compte SFTP DEDIE, rend ses identifiants une seule fois.
- `delete_sftp_account` — le supprime.

## Les fichiers d'un site

Jusqu'a la 0.2.0, une cle pouvait ECRASER les fichiers d'un site sans pouvoir
les lire : l'interdit etait pose du mauvais cote, puisque ecrire est
strictement plus dangereux que lire. La seule issue etait un mot de passe SFTP,
c'est-a-dire un secret durable colle dans une conversation pour contourner un
endpoint absent.

```
list_site_files(site_id)               -> un niveau de la racine publique
list_site_files(site_id, "assets")     -> on descend
read_site_file(site_id, "index.html")  -> le contenu, decode
```

L'id du site vient de `GET /api/v1/admin/sites`.

⚠️ `list_site_files` est une LECTURE, `read_site_file` est un SECRET. Le nom
d'un fichier revele une structure ; son contenu peut porter des identifiants
dans un `config.php` ou un `settings.js`. Le second disparait donc du mode
restreint, comme `get_credentials`.

⚠️ LES FICHIERS CACHES SONT HORS D'ATTEINTE, a tout niveau : `.env` comme
`assets/.env`. Le serveur refuse tout segment commencant par un point, aussi
bien au depot qu'a la lecture. Cette garde existait pour empecher qu'ils soient
SERVIS par le serveur web ; elle protege exactement le bon flanc.

Plafond : 2 Mo cote API, 256 Ko cote outil. Au-dela, le telechargement du
tableau de bord ou le SFTP.

## Le SFTP, sans donner le mot de passe du site

`ftpUsername` est l'IDENTITE d'un site : il ouvre tout le dossier, ne se scope
pas, n'expire pas, ne laisse aucune trace distinguable, et ne se revoque qu'en
le changeant partout ou il a ete colle. Le confier a un assistant, c'est lui
donner le site.

`create_sftp_account` fabrique un compte ADDITIONNEL sur le meme dossier, rend
host, port, identifiant et mot de passe UNE SEULE FOIS, et
`delete_sftp_account` le retire. Preter un badge, pas sa cle.

```
list_sftp_accounts(site_id)                 -> les comptes dedies existants
create_sftp_account(site_id)                -> host, port, user, password
delete_sftp_account(site_id, username)      -> on referme
```

⚠️ `create_sftp_account` est classe SECRET : il ne modifie aucune donnee et
rend pourtant de quoi ouvrir tout le dossier. Il disparait donc du mode
restreint, comme `get_credentials` et `read_site_file`.

⚠️ PLAFOND DE CINQ COMPTES PAR SITE, et cinq creations par tranche de cinq
minutes. Chaque compte est un utilisateur systeme reel : un agent qui reprend
sur erreur en recreant au lieu de reutiliser en fabriquerait des dizaines.

Pour une simple consultation, `list_site_files` et `read_site_file` suffisent
et ne creent rien.

## Lecture seule

```bash
claude mcp add clicbase \
  -e CLICBASE_API_KEY=cbk_... \
  -e CLICBASE_READ_ONLY=1 \
  -- node /chemin/absolu/vers/mcp/clicbase-mcp.mjs
```

En lecture seule, les outils qui écrivent ne sont **pas refusés : ils sont
absents**. Un outil présent qui répond « interdit » laisse l'assistant croire
qu'un chemin existe, donc essayer, reformuler, insister. Un outil qui n'est pas
dans la liste n'est jamais demandé.

Ce qui reste : `list_tables`, `describe_table`, `get_oauth_provider`.
Ce qui part : `run_sql`, `create_database`, `enable_realtime`, `enable_rls`,
`create_policy`, `set_oauth_provider`, `set_email_smtp`, et **`get_credentials`**.

> `get_credentials` ne modifie rien, et il part quand même. Il rend la clé
> `service` du projet, laquelle ouvre le SQL complet et contourne la RLS. Le
> garder reviendrait à retirer `run_sql` d'une main et à livrer de quoi le
> refaire de l'autre.

Un outil ajouté plus tard sans être classé dans `portee.mjs` est traité comme
une **écriture** : il disparaît du mode restreint au lieu d'y être admis. Un
oubli coûte alors une fonction manquante, que l'on remarque ; l'inverse aurait
coûté une écriture ouverte dans un mode qui promet de ne pas écrire.

## ⚠️ La forme de la commande npx

`npx -y @clicbase/mcp` **echouait** en `could not determine executable to run`
jusqu'a la version 0.1.1 : le paquet porte plusieurs commandes et aucune ne
s'appelait `mcp`, donc npx ne pouvait pas choisir. Deux formes sont justes :

```bash
npx -y -p @clicbase/mcp clicbase-mcp       # tout-en-un, marche des 0.1.0
npx -y -p @clicbase/mcp clicbase-db-mcp    # un seul projet
npx -y @clicbase/mcp                       # depuis 0.1.1 seulement
```

`-p` designe le PAQUET a installer, l'argument suivant la COMMANDE a lancer.
Sans lui, npx cherche une commande portant le dernier segment du nom du paquet.

## Un seul projet : `clicbase-db-mcp`

C'est la variante qu'utilise un client sur sa propre base. Elle ne cree pas de
projet et ne voit que celui qu'on lui donne :

```bash
claude mcp add ma-base \
  -e CLICBASE_DB_URL=https://clicbase.com/db/<slug> \
  -e CLICBASE_SERVICE_KEY=<cle service> \
  -e CLICBASE_READ_ONLY=1 \
  -- npx -y -p @clicbase/mcp clicbase-db-mcp
```

Les deux valeurs se trouvent dans le tableau de bord Clicbase, **section API du
projet** (`/dashboard?studio=<id>&section=api`) : « API REST » donne l'URL,
« Cle service » la cle. Ce n'est PAS une cle `cbk_` : celles-la servent au
serveur tout-en-un et n'apparaissent que pour qui possede un VPS ou un Docker.

## Ce que l'assistant sait avant son premier appel

Un serveur MCP qui n'expose que des outils laisse le modele deviner les
conventions de la plateforme. Depuis la 0.1.2, celui-ci remplit le champ
`instructions` du protocole : le client le pose dans le contexte du modele A LA
CONNEXION, avant tout appel. On ne peut donc pas oublier de le lire.

Six pieges y sont enumeres, et ils ont en commun de repondre **200 OK** :

1. `with check` n'est pas `using`. Sur INSERT et UPDATE, PostgreSQL n'evalue
   QUE `with check`.
2. Chaque nouvelle table accorde le CRUD a `authenticated` : un `grant select`
   ne restreint rien, il faut `revoke`.
3. Toute DDL se termine par `notify pgrst, 'reload schema';`.
4. `service_role` a besoin de `BYPASSRLS`, sinon 200 OK et un tableau vide.
5. Une fonction Edge rend `{ status, body }`, jamais `new Response(...)`.
6. L'auth du PROJET (schema `auth` de la base, `auth.uid()`) ne se confond pas
   avec celle de la PLATEFORME.

L'outil `clicbase_conventions` en rend le detail a la demande : formes exactes
des policies, ordre `revoke` puis `grant`, operateurs PostgREST. Il est classe
en LECTURE, donc il survit au mode restreint · c'est ce mode qui en a le plus
besoin, puisqu'il ne laisse que trois autres outils.

Le texte vit dans `savoir.mjs`, sans aucun import, pour rester chargeable par
les tests du depot.

## Quand l'utiliser

`run_sql` exécute du SQL arbitraire avec les droits du propriétaire de la base,
et la clé service **contourne la RLS** : un `SELECT` rend toutes les données
personnelles du projet en clair, et elles entrent dans le contexte du modèle.
Six risques n'ont aucune parade côté serveur, dont l'impossibilité de
distinguer un `DROP TABLE` prévu d'un `DROP TABLE` accidentel.

En clair :

| | mode complet | lecture seule |
| --- | --- | --- |
| Ta propre plateforme, sous tes yeux | oui | — |
| Un agent autonome | non | oui |
| La base d'un client | non | oui |

## Installation

```bash
claude mcp add clicbase \
  -e CLICBASE_API_KEY=cbk_... \
  -e CLICBASE_READ_ONLY=1 \
  -- npx -y -p @clicbase/mcp clicbase-mcp
```

> ⚠️ `CLICBASE_READ_ONLY=1` est volontairement dans la commande d'installation.
> C'est le mode à conseiller par défaut : il retire `run_sql`, la création de
> projet et la clé `service`. Retire cette ligne seulement quand tu sais
> pourquoi, et lis la section « Quand l'utiliser » avant.

### Depuis les sources

⚠️ `cd mcp` ne vaut que dans le monorepo Clicbase. Depuis le depot public, la
racine EST le paquet : ce README est publie aux deux endroits, et une ligne
juste d'un cote se trompe de l'autre.

```bash
git clone https://github.com/clicbase/mcp && cd mcp && npm install
```

## Configuration dans Claude Code

Le plus simple (depuis le dossier du site à connecter) :

```bash
claude mcp add clicbase -e CLICBASE_API_KEY=cbk_... -- node /chemin/absolu/vers/mcp/clicbase-mcp.mjs
```

Ou à la main dans la config MCP (`~/.claude.json` / `claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "clicbase": {
      "command": "node",
      "args": ["/chemin/absolu/vers/mcp/clicbase-mcp.mjs"],
      "env": {
        "CLICBASE_API_KEY": "cbk_..."
      }
    }
  }
}
```

## Utilisation : « Claude fait tout »

Dans la session Claude du site (ex. exoskool.com), une seule consigne suffit :

> « Connecte ce site à Clicbase via le MCP clicbase. Crée une base `exoskool`
> (domaine `exoskool.com`), crée le schéma dont le site a besoin (tables + RLS),
> puis branche le front sur l'API REST (clé anon) et écris les variables dans `.env`. »

Claude appellera `create_database`, puis `run_sql` pour le schéma/RLS, récupèrera
les clés via `get_credentials`, et câblera le site. Aucune clé à copier-coller à la main.


## Pourquoi une clé et pas un mot de passe

Ce serveur envoyait `ROROUIRA_EMAIL` + `ROROUIRA_PASSWORD`. Changé le
2026-09-13.

Un mot de passe est une **identité** : il ouvre le compte entier, doit vivre
en clair dans la configuration, et ne laisse aucune trace distinguable. Pour le
révoquer, il faut le changer partout où il a été collé, sans jamais savoir si
on a tout trouvé.

Une clé `cbk_…` est une **permission** :

| | mot de passe | clé API |
| --- | --- | --- |
| Portée | tout le compte | `vps`, `docker` ou granulaire |
| Expiration | aucune | `expiresAt`, automatique |
| Révocation | changer le mot de passe partout | un clic |
| Stockage serveur | — | seulement un `sha256` |
| Journal | indistinguable de toi | chaque appel, avec son `keyId` |

La clé se génère depuis le tableau de bord, menu **VPS** ou **Docker** ›
**Clés API**. Elle n'est affichée qu'une fois : le serveur n'en garde que
l'empreinte.
