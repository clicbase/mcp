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
  -- npx -y @clicbase/mcp
```

> ⚠️ `CLICBASE_READ_ONLY=1` est volontairement dans la commande d'installation.
> C'est le mode à conseiller par défaut : il retire `run_sql`, la création de
> projet et la clé `service`. Retire cette ligne seulement quand tu sais
> pourquoi, et lis la section « Quand l'utiliser » avant.

### Depuis le dépôt


```bash
cd mcp
npm install
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
