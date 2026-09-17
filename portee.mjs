// LA PORTÉE DES SERVEURS MCP : ce qu'une IA reçoit, et ce qu'elle ne voit pas.
//
// Demande de Teiki le 2026-09-17, après examen de ce que fait Supabase : leur
// serveur se configure par `read_only=true`, `project_ref` et `features`, et
// leur première ligne d'installation est un avertissement de sécurité.
//
// ⚠️ EN LECTURE SEULE, LES OUTILS QUI ÉCRIVENT NE SONT PAS REFUSÉS : ILS SONT
// ABSENTS. C'est la seule parade qui tienne. Un outil présent mais qui répond
// « interdit » laisse l'assistant croire qu'il existe un chemin, donc essayer,
// reformuler, insister. Un outil qui n'est pas dans la liste n'est jamais
// demandé : on ne réclame pas ce qu'on ne voit pas.
//
// ⚠️ ON NE FILTRE PAS L'INTENTION, ON RETIRE L'OUTIL. `DROP TABLE` est du DDL
// valide, et le DDL est la raison d'être de `run_sql` : aucune liste de mots
// interdits ne distingue « supprime l'ancienne table comme prévu » de
// « supprime la mauvaise ». La seule frontière qui tient passe par la présence
// de l'outil, pas par l'analyse de ce qu'on lui demande.

/**
 * Ce que chaque outil fait, du point de vue du risque.
 *
 *  · `lecture` : ne modifie rien et ne rend aucun secret.
 *  · `ecriture` : modifie la base, la configuration ou crée une ressource.
 *  · `secret` : ne modifie rien, mais REND UNE CLÉ qui, elle, permet tout.
 *
 * ⚠️ `secret` EXISTE POUR `get_credentials`, ET CE N'EST PAS UN EXCÈS DE ZÈLE.
 * Il ne modifie rien, donc il a l'air d'une lecture. Mais il rend la clé
 * `service` du projet, laquelle ouvre le SQL complet et contourne la RLS.
 * Le laisser en mode lecture seule reviendrait à retirer `run_sql` d'une main
 * et à livrer de quoi le refaire de l'autre.
 */
export const OUTILS = {
  // --- serveur « tout-en-un » ---
  create_database: "ecriture",
  get_credentials: "secret",
  run_sql: "ecriture",
  list_tables: "lecture",
  enable_realtime: "ecriture",
  set_oauth_provider: "ecriture",
  set_email_smtp: "ecriture",
  // --- serveur « base d'un projet » ---
  describe_table: "lecture",
  enable_rls: "ecriture",
  create_policy: "ecriture",
  get_oauth_provider: "lecture",
  // ⚠️ RENDU EN LECTURE SEULE, ET C'EST TOUT L'INTERET. Cet outil ne rend que
  // du texte : les conventions de la plateforme. C'est precisement le mode
  // restreint qui en a le plus besoin, puisqu'il ne reste alors que trois
  // outils et qu'un assistant doit deviner le reste.
  clicbase_conventions: "lecture",
};

/** Ce qu'on garde en lecture seule. */
const PERMIS_EN_LECTURE = new Set(["lecture"]);

/**
 * Le serveur tourne-t-il en lecture seule ?
 *
 * ⚠️ TOUTE VALEUR AUTRE QUE « 0 », « false » OU VIDE ACTIVE LE MODE. La
 * variable est là pour fermer : quelqu'un qui écrit `CLICBASE_READ_ONLY=oui`
 * veut manifestement fermer, et un jeu de valeurs trop strict lui ouvrirait
 * tout en silence. On ferme au moindre doute, jamais l'inverse.
 *
 * ⚠️ LE PARAMÈTRE EST ANNOTÉ LARGEMENT, ET PAS LAISSÉ À L'INFÉRENCE. Sans cette
 * ligne, TypeScript déduit le type de la valeur par défaut, donc `ProcessEnv`,
 * qui EXIGE `NODE_ENV` : un test ne pourrait plus passer un environnement
 * fabriqué, et la bascule deviendrait invérifiable.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function lectureSeule(env = process.env) {
  const v = (env.CLICBASE_READ_ONLY ?? "").trim().toLowerCase();
  if (v === "" || v === "0" || v === "false" || v === "non") return false;
  return true;
}

/**
 * Cet outil doit-il être proposé ?
 *
 * ⚠️ UN OUTIL INCONNU EST TRAITÉ COMME UNE ÉCRITURE. C'est le point le plus
 * important de ce fichier. Le jour où quelqu'un ajoute un outil sans le classer
 * ici, il sera RETIRÉ du mode lecture seule au lieu d'y être admis par défaut.
 * Un oubli coûte alors une fonction manquante, que l'on remarque ; l'autre
 * défaut aurait coûté une écriture ouverte dans un mode qui promet de ne pas
 * écrire, et celui-là ne se remarque pas.
 */
export function outilPermis(nom, enLectureSeule) {
  if (!enLectureSeule) return true;
  const genre = OUTILS[nom] ?? "ecriture";
  return PERMIS_EN_LECTURE.has(genre);
}

/**
 * Enveloppe `server.tool` pour n'enregistrer que ce qui est permis.
 *
 * Renvoie aussi la liste de ce qui a été retiré, pour que le serveur puisse le
 * DIRE au démarrage : un mode restreint silencieux se découvre en pleine
 * session, quand un outil attendu manque sans explication.
 */
export function filtre(server, enLectureSeule) {
  const retires = [];
  return {
    tool(nom, ...reste) {
      if (!outilPermis(nom, enLectureSeule)) {
        retires.push(nom);
        return;
      }
      server.tool(nom, ...reste);
    },
    retires,
  };
}
