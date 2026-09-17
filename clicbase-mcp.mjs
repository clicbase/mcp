#!/usr/bin/env node
// MCP Clicbase "tout-en-un" : Claude provisionne ET administre une base.
//
// ⚠️ AUTHENTIFICATION PAR CLE API, PLUS PAR MOT DE PASSE. Ce fichier envoyait
// ROROUIRA_EMAIL + ROROUIRA_PASSWORD, ce qui donnait a un programme l'acces au
// COMPTE ENTIER : pas de portee, pas d'expiration, pas de plafond, aucune
// trace distinguable dans le journal, et une revocation qui oblige a changer
// le mot de passe partout ou il a ete colle.
//
// Une cle `cbk_…` est une PERMISSION, pas une identite : portee, expiration,
// revocation d'un clic, et chaque appel journalise avec son keyId. Le secret
// n'est jamais stocke cote serveur, seulement son sha256.
//
// C'etait aussi le seul endroit du depot qui contredisait la regle « Teiki ne
// se connecte jamais par mot de passe ». Corrige le 2026-09-13.
//
//   export CLICBASE_API_KEY=cbk_...   (genere depuis le tableau de bord)
// L'API de provisioning est idempotente -> on l'utilise aussi pour résoudre
// dynamiquement l'URL + la clé service d'un projet (par nom).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { filtre, lectureSeule } from "./portee.mjs";
import { CONVENTIONS, INSTRUCTIONS } from "./savoir.mjs";

const API = process.env.CLICBASE_API ?? process.env.ROROUIRA_API ?? "https://clicbase.com/api/v1/databases";

/** La cle, lue une fois. Absente, on le dit tout de suite plutot que de
 *  laisser chaque appel echouer en 401 sans expliquer ce qui manque. */
const CLE = process.env.CLICBASE_API_KEY;
if (!CLE) {
  console.error(
    "CLICBASE_API_KEY manquante. Genere une cle depuis le tableau de bord " +
      "(menu VPS ou Docker > Cles API), puis : export CLICBASE_API_KEY=cbk_...",
  );
  process.exit(1);
}
const out = (d) => ({ content: [{ type: "text", text: typeof d === "string" ? d : JSON.stringify(d, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });

// Provisionne (ou récupère, idempotent) un projet et renvoie ses infos.
const cache = new Map();
async function resolve(name, domain) {
  if (cache.has(name)) return cache.get(name);
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // ⚠️ UNE CLE, PAS UN MOT DE PASSE. Voir l'en-tete du fichier.
      authorization: `Bearer ${CLE}`,
    },
    body: JSON.stringify({ name, domain }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clicbase ${res.status}: ${JSON.stringify(data)}`);
  const info = {
    url: data.restApi?.url,
    anonKey: data.restApi?.anonKey,
    serviceKey: data.restApi?.serviceKey,
    connectionString: data.connectionString,
    raw: data,
  };
  cache.set(name, info);
  return info;
}

// Appel d'un endpoint du projet avec la clé service.
async function call(name, path, method = "POST", body) {
  const p = await resolve(name);
  if (!p.url || !p.serviceKey) throw new Error("Projet non résolu (clés manquantes).");
  const res = await fetch(`${p.url}${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${p.serviceKey}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ⚠️ `instructions` EST LU A LA CONNEXION, AVANT LE PREMIER APPEL. C'est le
// seul endroit qu'un assistant ne peut pas oublier de consulter : le client
// MCP le pose dans le contexte du modele. Sans lui, un assistant recevait
// TROIS outils et trente mots de description, puis devinait les conventions
// de la plateforme. Voir savoir.mjs.
const server = new McpServer(
  { name: "clicbase", version: "2.0.0" },
  { instructions: INSTRUCTIONS },
);

// ⚠️ EN LECTURE SEULE, LES OUTILS QUI ECRIVENT NE SONT PAS ENREGISTRES. Voir
// portee.mjs : un outil absent n'est jamais demande, un outil present qui
// refuse invite a insister. `outils.tool(...)` remplace l'appel direct.
const SEULEMENT_LECTURE = lectureSeule();
const outils = filtre(server, SEULEMENT_LECTURE);

outils.tool(
  "clicbase_conventions",
  "Les conventions Clicbase : formes exactes des policies RLS, droits par defaut, rechargement du schema, appels REST, fonctions Edge. A lire AVANT d'ecrire du SQL ou une policy.",
  {},
  async () => ({ content: [{ type: "text", text: CONVENTIONS }] }),
);

outils.tool(
  "create_database",
  "Crée (ou récupère, idempotent) une base Clicbase pour un site. Renvoie la chaîne de connexion PostgreSQL, l'URL de l'API REST et les clés anon/service.",
  { name: z.string().describe("Nom du projet, ex. exoskool"), domain: z.string().optional().describe("Domaine, ex. exoskool.com") },
  async ({ name, domain }) => {
    try { cache.delete(name); return out((await resolve(name, domain)).raw); } catch (e) { return fail(e); }
  },
);

outils.tool(
  "get_credentials",
  "Renvoie les identifiants d'un projet existant (connexion Postgres + URL REST + clés anon/service) pour brancher le site.",
  { name: z.string() },
  async ({ name }) => { try { return out((await resolve(name)).raw); } catch (e) { return fail(e); } },
);

outils.tool(
  "run_sql",
  "Exécute du SQL (DDL/DML/RLS) sur la base d'un projet. Pour créer des tables, policies RLS, etc. Termine par: NOTIFY pgrst, 'reload schema'; après un changement de schéma.",
  { name: z.string().describe("Nom du projet"), query: z.string() },
  async ({ name, query }) => { try { return out(await call(name, "/sql", "POST", { query })); } catch (e) { return fail(e); } },
);

outils.tool(
  "list_tables",
  "Liste les tables du schéma public d'un projet.",
  { name: z.string() },
  async ({ name }) => {
    try { return out(await call(name, "/sql", "POST", { query: "select table_name from information_schema.tables where table_schema='public' order by table_name" })); } catch (e) { return fail(e); }
  },
);

outils.tool(
  "enable_realtime",
  "Active le temps réel (WebSocket) sur une table d'un projet.",
  { name: z.string(), table: z.string() },
  async ({ name, table }) => { try { return out(await call(name, "/realtime/enable", "POST", { table })); } catch (e) { return fail(e); } },
);

outils.tool(
  "set_oauth_provider",
  "Configure un provider OAuth (ex. google) d'un projet. URI de redirection à déclarer chez le fournisseur : <url REST du projet>/auth/callback/<provider>.",
  { name: z.string(), provider: z.enum(["google"]), client_id: z.string(), client_secret: z.string() },
  async ({ name, provider, client_id, client_secret }) => {
    try { return out(await call(name, `/auth/providers/${provider}`, "POST", { client_id, client_secret })); } catch (e) { return fail(e); }
  },
);

outils.tool(
  "set_email_smtp",
  "Configure le SMTP d'un projet (sinon le SMTP interne Clicbase est utilisé par défaut).",
  { name: z.string(), host: z.string(), port: z.number().optional(), secure: z.boolean().optional(), username: z.string().optional(), password: z.string().optional(), sender_email: z.string(), sender_name: z.string().optional() },
  async ({ name, ...cfg }) => { try { return out(await call(name, "/email/config", "POST", cfg)); } catch (e) { return fail(e); } },
);

// ⚠️ LE MODE RESTREINT S'ANNONCE, SUR LA SORTIE D'ERREUR. Un serveur qui
// retire des outils en silence se decouvre en pleine session : l'assistant
// cherche une fonction qui devrait exister, ne la trouve pas, et conclut que le
// serveur est casse. Deux lignes evitent cette demi-heure. La sortie STANDARD
// est reservee au protocole MCP : y ecrire casserait la conversation.
if (SEULEMENT_LECTURE) {
  console.error(
    `[clicbase-mcp] LECTURE SEULE. Outils retires : ${outils.retires.join(", ") || "aucun"}.`,
  );
  console.error(
    "[clicbase-mcp] Pour tout ouvrir : retirer CLICBASE_READ_ONLY de la configuration.",
  );
}

await server.connect(new StdioServerTransport());
