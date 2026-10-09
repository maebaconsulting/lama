// Transforme ce que l'utilisateur colle après « rclone authorize » en configuration
// rclone pour Google Drive, écrite sur la sortie standard.
// Lit sur l'entrée standard (jamais en argument : un argument est visible dans ps).
// Accepte seulement le bloc codé que renvoie `rclone authorize "drive" "<bloc>"` (JSON
// {"token": "..."} en base64 sans remplissage). Un jeton brut vient de
// `rclone authorize "drive"` sans bloc, qui donne l'accès à tout le Drive : refusé.
// Messages en français ou en anglais, par la même règle que deploy/langue.sh.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Langue des messages : LAMA_LANGUE (fr ou en) force, sinon anglais si LANG commence par en, français sinon. */
export function langue(env = process.env) {
  if (env.LAMA_LANGUE === "fr" || env.LAMA_LANGUE === "en") return env.LAMA_LANGUE;
  return (env.LANG ?? "").toLowerCase().startsWith("en") ? "en" : "fr";
}

/** Texte dans la langue des scripts : msg("texte", "text"). */
const msg = (fr, en) => (langue() === "en" ? en : fr);

/** Construit la configuration rclone du remote Google Drive à partir du texte collé. */
export function configurationDrive(texte, remote = "gdrive") {
  const compact = texte.replace(/\s+/g, "");
  if (compact.startsWith("{")) throw new Error(msg("Ce jeton donne accès à tout le Drive. Lancez la commande rclone authorize affichée, avec son bloc, et collez ce qu'elle renvoie.", "This token gives access to the whole Drive. Run the rclone authorize command shown, with its block, and paste what it returns."));
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error(msg("Ce texte n'est pas le bloc renvoyé par rclone authorize.", "This text is not the block returned by rclone authorize."));
  let bloc;
  try {
    bloc = JSON.parse(Buffer.from(compact, "base64").toString("utf8"));
  } catch {
    throw new Error(msg("Le bloc collé est incomplet. Recopiez tout le texte entre les deux lignes de flèches.", "The pasted block is incomplete. Copy all the text between the two lines of arrows."));
  }
  if (typeof bloc?.token !== "string") throw new Error(msg("Le bloc collé ne contient pas de jeton Google.", "The pasted block contains no Google token."));
  const jeton = bloc.token;
  let objet;
  try {
    objet = JSON.parse(jeton);
  } catch {
    throw new Error(msg("Le jeton collé est incomplet. Recopiez tout le texte entre les deux lignes de flèches.", "The pasted token is incomplete. Copy all the text between the two lines of arrows."));
  }
  if (typeof objet?.access_token !== "string" || !objet.access_token) throw new Error(msg("Le texte collé ne contient pas de jeton d'accès Google.", "The pasted text contains no Google access token."));
  return `[${remote}]\ntype = drive\nscope = drive.file\ntoken = ${JSON.stringify(objet)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.stdout.write(configurationDrive(readFileSync(0, "utf8")));
  } catch (erreur) {
    process.stderr.write(`${erreur.message}\n`);
    process.exit(1);
  }
}
