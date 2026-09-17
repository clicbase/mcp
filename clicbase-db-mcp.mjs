#!/usr/bin/env node
// Serveur MCP d'administration d'UNE base Clicbase (scopé à un projet).
// Emballe l'endpoint /sql (clé service) en outils MCP.
// Env requis : CLICBASE_DB_URL (ex. https://clicbase.com/db/mon-projet)
//              CLICBASE_SERVICE_KEY (clé service du projet — côté outil uniquement)
//
// ⚠️ LES ANCIENS NOMS RESTENT ACCEPTÉS, EN SECOND. `ROROUIRA_DB_URL` et
// `ROROUIRA_SERVICE_KEY` continuent de fonctionner : une configuration déjà
// posée chez quelqu'un ne doit pas cesser de marcher parce que nous avons
// renommé la maison. Ils disparaîtront quand plus personne ne les utilisera.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { filtre, lectureSeule } from "./portee.mjs";
import { CONVENTIONS, INSTRUCTIONS } from "./savoir.mjs";

const BASE = process.env.CLICBASE_DB_URL ?? process.env.ROROUIRA_DB_URL;
const KEY = process.env.CLICBASE_SERVICE_KEY ?? process.env.ROROUIRA_SERVICE_KEY;
if (!BASE || !KEY) {
  console.error(
    "CLICBASE_DB_URL et CLICBASE_SERVICE_KEY requis. " +
      "Exemple : CLICBASE_DB_URL=https://clicbase.com/db/mon-projet",
  );
  process.exit(1);
}

const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

async function sql(query) {
  const res = await fetch(`${BASE}/sql`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
// Appel générique d'un endpoint du projet (autre que /sql), avec la clé service.
async function api(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", Authorization: `Bearer ${KEY}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const out = (d) => ({ content: [{ type: "text", text: JSON.stringify(d, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });

// ⚠️ `instructions` EST LU A LA CONNEXION, AVANT LE PREMIER APPEL. C'est le
// seul endroit qu'un assistant ne peut pas oublier de consulter : le client
// MCP le pose dans le contexte du modele. Sans lui, un assistant recevait
// TROIS outils et trente mots de description, puis devinait les conventions
// de la plateforme. Voir savoir.mjs.
const server = new McpServer(
  { name: "clicbase-db", version: "1.0.0" },
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
  "run_sql",
  "Exécute du SQL (DDL/DML/RLS) sur la base. Après un changement de schéma, termine par: NOTIFY pgrst, 'reload schema';",
  { query: z.string() },
  async ({ query }) => {
    try {
      return out(await sql(query));
    } catch (e) {
      return fail(e);
    }
  },
);

outils.tool("list_tables", "Liste les tables du schéma public.", {}, async () => {
  try {
    return out(
      await sql(
        "select table_name from information_schema.tables where table_schema='public' order by table_name",
      ),
    );
  } catch (e) {
    return fail(e);
  }
});

outils.tool(
  "describe_table",
  "Décrit les colonnes d'une table (nom, type, nullable, défaut).",
  { table: z.string() },
  async ({ table }) => {
    try {
      return out(
        await sql(
          `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=${lit(table)} order by ordinal_position`,
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

outils.tool(
  "enable_rls",
  "Active la Row-Level Security sur une table.",
  { table: z.string() },
  async ({ table }) => {
    try {
      return out(
        await sql(
          `alter table ${ident(table)} enable row level security; notify pgrst, 'reload schema';`,
        ),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

outils.tool(
  "create_policy",
  "Crée (ou remplace) une policy RLS. using/check sont des expressions SQL (ex: \"auth.uid() is not null\", \"user_id = auth.uid()\").",
  {
    table: z.string(),
    name: z.string(),
    command: z.enum(["select", "insert", "update", "delete", "all"]),
    using: z.string().optional(),
    check: z.string().optional(),
  },
  async ({ table, name, command, using, check }) => {
    try {
      let s = `drop policy if exists ${ident(name)} on ${ident(table)}; create policy ${ident(name)} on ${ident(table)} for ${command}`;
      if (using) s += ` using (${using})`;
      if (check) s += ` with check (${check})`;
      s += `; notify pgrst, 'reload schema';`;
      return out(await sql(s));
    } catch (e) {
      return fail(e);
    }
  },
);

outils.tool(
  "get_oauth_provider",
  "Donne le statut d'un provider OAuth (ex. google) : activé ou non.",
  { provider: z.enum(["google"]) },
  async ({ provider }) => {
    try {
      return out(await api(`/auth/providers/${provider}`));
    } catch (e) {
      return fail(e);
    }
  },
);

outils.tool(
  "set_oauth_provider",
  "Configure un provider OAuth (ex. google) avec son client_id et son client_secret (chiffré côté serveur). L'URI de redirection à déclarer chez le fournisseur est: <ROROUIRA_DB_URL>/auth/callback/<provider>.",
  {
    provider: z.enum(["google"]),
    client_id: z.string(),
    client_secret: z.string(),
  },
  async ({ provider, client_id, client_secret }) => {
    try {
      return out(
        await api(`/auth/providers/${provider}`, "POST", {
          client_id,
          client_secret,
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
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
