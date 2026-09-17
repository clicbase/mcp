// CE QUE L'ASSISTANT DOIT SAVOIR, ET QU'AUCUN OUTIL NE LUI APPREND.
//
// Question de Teiki le 2026-09-17 : « quand un client ajoute la commande MCP à
// son IA, elle va tout comprendre ? » Mesuré dans le paquet publié, la réponse
// était non. En lecture seule, un assistant reçoit TROIS outils et une
// trentaine de mots de description. Il sait explorer un schéma. Il ignore tout
// ce qui fait perdre des journées ici.
//
// ⚠️ LES SIX PIÈGES CI-DESSOUS SONT RÉELS, PAS THÉORIQUES. Ils viennent de la
// section « Pièges qui ont déjà coûté cher » du dépôt, écrite après coup à
// chaque fois. Ils ont en commun de ne produire NI exception NI ligne de
// journal : une policy qui ne protège rien répond 200, un grant qui ne
// restreint pas répond 200, une clé service sans BYPASSRLS répond 200 avec un
// tableau vide. Un assistant qui les ignore croit avoir réussi.
//
// ⚠️ DEUX CANAUX, ET CE N'EST PAS UNE REDONDANCE. `INSTRUCTIONS` part dans le
// champ prévu par le protocole : le client MCP le pose dans le contexte du
// modèle À LA CONNEXION, avant le premier appel, et on ne peut donc pas
// oublier de le lire. `CONVENTIONS` est le détail, rendu par un outil quand
// l'assistant en a besoin. Tout mettre dans le premier gonflerait chaque
// conversation ; tout mettre dans le second laisserait l'assistant écrire une
// policy fausse sans avoir jamais su qu'il fallait demander.
//
// ⚠️ CE FICHIER N'IMPORTE RIEN, exprès : le lanceur de tests du dépôt charge
// les modules voisins avec leur extension, et un import casserait sa lecture.

/** Posé dans le contexte du modèle dès la connexion. Court par obligation. */
export const INSTRUCTIONS = `Tu es connecté à un projet Clicbase : une base PostgreSQL managée, exposée en API REST par PostgREST.

SIX PIÈGES QUI NE LÈVENT AUCUNE ERREUR. Ils répondent tous « 200 OK ».
1. \`with check\` n'est PAS \`using\`. Sur INSERT et UPDATE, PostgreSQL n'évalue QUE \`with check\`. Une policy qui n'a qu'un \`using\` ne protège pas l'écriture.
2. Chaque nouvelle table accorde le CRUD à \`authenticated\` par défaut. Un \`grant select\` ne restreint RIEN : il faut \`revoke\`.
3. Après tout changement de schéma, termine par \`notify pgrst, 'reload schema';\` sinon l'API continue de servir l'ancien schéma.
4. Le rôle \`service_role\` a besoin de \`BYPASSRLS\`. Sans lui : 200 OK et un tableau vide, sans explication.
5. Une fonction Edge renvoie \`{ status, body }\`, jamais \`new Response(...)\`.
6. Deux authentifications sans rapport coexistent. Celle du PROJET (tes utilisateurs finaux) vit dans le schéma \`auth\` de cette base et alimente \`auth.uid()\` dans les policies. Celle de la PLATEFORME (le compte Clicbase) ne s'écrit jamais dans une policy.

CE QUI N'EXISTE PAS, ET QUE DEUX ASSISTANTS ONT DEJA INVENTE. Il n'y a AUCUN registre Docker : ni \`docker login\`, ni \`docker pull\`, ni \`registry.*.clicbase.com\`. Ne devine aucun nom d'hote. Ce serveur MCP ne rend pas le code source d'un site heberge : pour recuperer des fichiers, c'est le SFTP du tableau de bord ou son gestionnaire de fichiers, et l'API d'administration ne fait que les ECRIRE (POST /sites/<id>/files), jamais les lire.

APPELS REST : en-têtes \`apikey\` ET \`Authorization: Bearer\`, la même clé dans les deux. Filtres dans l'URL, façon PostgREST : \`?select=id,title&status=eq.published&order=created_at.desc\`.

DEUX CLÉS À NE PAS CONFONDRE. \`anon\` est publique et soumise à la RLS, elle va dans le navigateur. \`service\` CONTOURNE la RLS et voit tout : serveur uniquement, jamais dans un front, jamais dans un dépôt.

Appelle \`clicbase_conventions\` avant d'écrire du SQL ou une policy : tu y trouveras les formes exactes.`;

/** Le détail, rendu à la demande par un outil de lecture. */
export const CONVENTIONS = `# Conventions Clicbase

## Row Level Security

\`\`\`sql
alter table articles enable row level security;

-- LECTURE : using suffit.
create policy "lecture_publique" on articles
  for select to anon, authenticated using (status = 'published');

-- ÉCRITURE : with check est OBLIGATOIRE, using ne sert pas.
create policy "chacun_ses_lignes" on articles
  for insert to authenticated with check (user_id = auth.uid());

create policy "modifier_les_siennes" on articles
  for update to authenticated
  using (user_id = auth.uid())          -- quelles lignes il peut viser
  with check (user_id = auth.uid());    -- ce qu'il peut y écrire

notify pgrst, 'reload schema';
\`\`\`

⚠️ Sur UPDATE, les deux clauses ont des rôles différents : \`using\` choisit les
lignes visées, \`with check\` valide le résultat. Omettre la seconde laisse
réécrire \`user_id\` vers quelqu'un d'autre.

## Les droits, avant la RLS

La RLS filtre les lignes ; les GRANT décident si la table est atteignable. Une
nouvelle table est ouverte en CRUD à \`authenticated\` par défaut, donc :

\`\`\`sql
revoke all on articles from anon, authenticated;
grant select on articles to anon, authenticated;
grant insert, update, delete on articles to authenticated;
\`\`\`

Un \`grant select\` seul n'enlève rien : il ajoute. C'est \`revoke\` qui ferme.

## auth.uid()

Il rend le \`sub\` du JWT du projet, donc l'identifiant de l'utilisateur final
connecté. Il vaut NULL avec la clé \`anon\`. Une policy qui doit exiger un compte
écrit \`auth.uid() is not null\`, pas \`true\`.

## API REST

\`\`\`
GET /db/<slug>/articles?select=id,title&status=eq.published&order=created_at.desc
en-têtes : apikey: <clé>   et   Authorization: Bearer <clé>
\`\`\`

Opérateurs : \`eq.\`, \`neq.\`, \`gt.\`, \`gte.\`, \`lt.\`, \`lte.\`, \`like.\`, \`ilike.\`,
\`in.(a,b)\`, \`is.null\`. Les relations se tirent par \`select=*,auteur(*)\`.

## Après toute DDL

\`notify pgrst, 'reload schema';\` dans la même exécution. Sans cela, la table
existe en base et l'API répond 404 : le défaut ressemble à une erreur de nom.

## Fonctions Edge

\`\`\`js
export default async function (req) {
  return { status: 200, body: { ok: true } };
}
\`\`\`

Jamais \`new Response(...)\` : l'hôte attend un objet, pas une réponse HTTP.

## Ce qu'aucun outil ne fera pour toi

Distinguer un \`drop table\` prévu d'un \`drop table\` accidentel. Le DDL est la
raison d'être de \`run_sql\`, et aucune liste de mots interdits ne sépare les
deux. Avant un ordre destructeur, dis ce que tu vas faire et demande.`;
