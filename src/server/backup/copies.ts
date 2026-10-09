/**
 * Copies de sécurité laissées à côté de la base (V1-02, décision 1 de la
 * passe V 1.0) : `avant-migration-*.db` (copie prise avant une migration) et
 * `avant-restauration-*.db` (base mise de côté par une restauration, avec son
 * éventuel `-wal`). Une fois l'application démarrée sans erreur, chaque copie
 * en clair est chiffrée pour la clé publique des sauvegardes (`.db.gz.age`,
 * même format que les sauvegardes, lisible par `decryptBackup`) puis effacée ;
 * sans clé réglée, elle reste en clair, lisible par le seul compte du service
 * (0600). Dans les deux cas, on garde les 3 copies les plus récentes de
 * chaque sorte.
 */
import { chmodSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sealFile } from "./backup.ts";

export const COPY_KINDS = ["avant-migration", "avant-restauration"] as const;
export const COPIES_KEPT = 3;

const PLAIN = /\.db$/;
const SEALED = /\.db\.gz\.age$/;

/** Nom sans extension : l'ordre de ces noms est l'ordre du temps (`…-1200` avant `…-1200-2`). */
const stem = (name: string) => name.replace(SEALED, "").replace(PLAIN, "");

/** Copies d'une sorte, en clair ou chiffrées, de la plus récente à la plus ancienne. */
function copiesOf(dataDir: string, kind: string): string[] {
  return readdirSync(dataDir)
    .filter((f) => f.startsWith(`${kind}-`) && (PLAIN.test(f) || SEALED.test(f)))
    .sort((a, b) => (stem(a) < stem(b) ? 1 : stem(a) > stem(b) ? -1 : 0));
}

/** Efface une copie et, pour une base en clair, son `-wal` et son `-shm`. */
function remove(dataDir: string, name: string): void {
  for (const suffix of PLAIN.test(name) ? ["", "-wal", "-shm"] : [""]) rmSync(join(dataDir, name + suffix), { force: true });
}

/**
 * Chiffre une copie en clair : copie cohérente par `VACUUM INTO` (transactions
 * encore dans le `-wal` comprises), compressée puis chiffrée ; la copie
 * intermédiaire ne reste jamais sur le disque.
 */
async function seal(dataDir: string, name: string, recipient: string): Promise<string> {
  const source = join(dataDir, name);
  const flat = join(dataDir, `${stem(name)}.tmp`);
  rmSync(flat, { force: true });
  try {
    const db = new DatabaseSync(source);
    try {
      db.prepare("VACUUM INTO ?").run(flat);
    } finally {
      db.close();
    }
  } catch (error) {
    rmSync(flat, { force: true });
    throw error;
  }
  const sealed = `${stem(name)}.db.gz.age`;
  await sealFile(flat, join(dataDir, sealed), recipient);
  remove(dataDir, name);
  return sealed;
}

/**
 * À appeler une fois l'application démarrée sans erreur : chiffre (ou
 * protège en 0600 sans clé) puis élague les copies de sécurité. Renvoie les
 * copies chiffrées et les copies supprimées, pour la console.
 */
export async function secureLocalCopies(dataDir: string, recipient: string, keep = COPIES_KEPT): Promise<{ sealed: string[]; removed: string[] }> {
  const sealed: string[] = [];
  const removed: string[] = [];
  if (!existsSync(dataDir)) return { sealed, removed };
  for (const kind of COPY_KINDS) {
    const all = copiesOf(dataDir, kind);
    for (const name of all.slice(keep)) {
      remove(dataDir, name);
      removed.push(name);
    }
    for (const name of all.slice(0, keep).filter((f) => PLAIN.test(f))) {
      if (recipient) {
        sealed.push(await seal(dataDir, name, recipient));
      } else {
        for (const suffix of ["", "-wal", "-shm"]) {
          if (existsSync(join(dataDir, name + suffix))) chmodSync(join(dataDir, name + suffix), 0o600);
        }
      }
    }
  }
  return { sealed, removed };
}
