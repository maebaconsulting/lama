/**
 * Colonne `supplements_possibles` de l'import du catalogue (spec du 18/10/2026 § 2.2 et § 3.1) : noms
 * séparés par `|`, une prestation pouvant s'écrire `Univers > Nom`. Écrite après les prestations du
 * fichier, dans la transaction de l'import : les noms sont alors reconnus parmi les prestations actives
 * telles que l'import les laisse (celles du fichier comprises), puis parmi les produits. Les règles d'une
 * liste sont celles de la fiche prestation (`parseList`, `writeList`) : chaque refus est rendu avec sa
 * ligne, sous un motif `catalogue.*` (fragment écrit après « Ligne N : »), et l'appelant annule tout
 * s'il en reste un.
 */
import type { Database } from "../storage.ts";
import type { MessageKey } from "../messages.ts";
import type { Refus } from "../import/csv.ts";
import { cle, indexerPrestations } from "../import/commun.ts";
import { parseList, SupplementError, writeList, type SupplementRef } from "../supplements/catalogue.ts";

/** Motif de l'import pour chaque refus de la fiche prestation (`SupplementError`). */
const MOTIFS: Partial<Record<MessageKey, MessageKey>> = {
  "supplement.lui_meme": "catalogue.supplement_lui_meme",
  "supplement.a_une_liste": "catalogue.supplement_en_cascade",
  "supplement.deja_supplement": "catalogue.supplement_deja",
  "supplement.seulement_liste": "catalogue.supplement_seulement_liste",
  "supplement.liste_invalide": "catalogue.supplements_trop",
};

/** Liste lue d'une ligne du fichier, pour la prestation `serviceId` déjà écrite. */
export interface ListeImportee { ligne: number; serviceId: number; noms: string[] }

/** Reconnaît un nom : prestation (nom unique ou `Univers > Nom`), à défaut produit (nom unique). */
function resoudre(db: Database): (nom: string) => SupplementRef | Omit<Refus, "ligne"> {
  const prestation = indexerPrestations(db);
  const produits = new Map<string, number[]>();
  for (const p of db.prepare("SELECT id, name FROM products ORDER BY id").all() as { id: number; name: string }[]) {
    produits.set(cle(p.name), [...(produits.get(cle(p.name)) ?? []), p.id]);
  }
  return (nom) => {
    const p = prestation(nom);
    if ("trouve" in p) return { kind: "service", ref_id: p.trouve.id };
    // Plusieurs prestations de ce nom, ou `Univers > Nom` introuvable : jamais un produit.
    if (p.motif === "import.prestation_ambigue") return { motif: "catalogue.supplement_ambigu", valeurs: { nom } };
    if (nom.includes(">")) return { motif: "catalogue.supplement_introuvable", valeurs: { nom } };
    const ids = produits.get(cle(nom)) ?? [];
    if (ids.length === 1) return { kind: "product", ref_id: ids[0] };
    return { motif: ids.length > 1 ? "catalogue.supplement_produit_ambigu" : "catalogue.supplement_introuvable", valeurs: { nom } };
  };
}

/**
 * Remplace les listes du fichier, dans la transaction de l'appelant. Toutes sont d'abord vidées, puis
 * écrites dans l'ordre du fichier avec les contrôles de la fiche prestation : une règle enfreinte entre
 * deux lignes (cascade, prestation déjà supplément) est trouvée quel que soit leur ordre. Rend les refus,
 * un au plus par ligne ; s'il y en a, l'appelant ne doit rien garder de ce qui a été écrit.
 */
export function ecrireListes(db: Database, listes: ListeImportee[]): Refus[] {
  const reconnaitre = resoudre(db);
  const vider = db.prepare("DELETE FROM service_supplements WHERE service_id = ?");
  for (const l of listes) vider.run(l.serviceId);
  const refus: Refus[] = [];
  for (const l of listes) {
    const items: SupplementRef[] = [];
    let echec: Omit<Refus, "ligne"> | null = null;
    for (const nom of l.noms) {
      const r = reconnaitre(nom);
      if ("motif" in r) {
        echec = r;
        break;
      }
      items.push(r);
    }
    if (!echec) {
      try {
        writeList(db, l.serviceId, parseList(items));
      } catch (e) {
        if (!(e instanceof SupplementError)) throw e;
        const motif = MOTIFS[e.key] ?? e.key;
        echec = Object.keys(e.values).length > 0 ? { motif, valeurs: e.values } : { motif };
      }
    }
    if (echec) refus.push({ ligne: l.ligne, ...echec });
  }
  return refus;
}
