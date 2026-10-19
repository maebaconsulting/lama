/**
 * Rubrique « Import » (spec du 18/10/2026 § 2.1) : les quatre imports, leurs adresses et ce que montre
 * l'aperçu. Sans dépendance d'écran : essayé sous Node.
 */
import type { Key, PluralBase } from "../i18n/translate.ts";
import type { ApercuImport, TypeImport } from "../../shared/import.ts";
import { deviseActive } from "../../shared/devise-active.ts";

export interface DefinitionImport { type: TypeImport; titreKey: Key; aideKey: Key }

export const IMPORTS: DefinitionImport[] = [
  { type: "catalogue", titreKey: "import.catalogue.titre", aideKey: "import.catalogue.aide" },
  { type: "clientes", titreKey: "import.clientes.titre", aideKey: "import.clientes.aide" },
  { type: "produits", titreKey: "import.produits.titre", aideKey: "import.produits.aide" },
  { type: "rendez-vous", titreKey: "import.rendez_vous.titre", aideKey: "import.rendez_vous.aide" },
];

const option = (type: TypeImport, desactiver: boolean) => (type === "catalogue" && desactiver ? "?desactiver=1" : "");

export const cheminModele = (type: TypeImport) => `/api/import/${type}/modele`;
export const cheminApercu = (type: TypeImport, desactiver: boolean) => `/api/import/${type}/apercu${option(type, desactiver)}`;
export const cheminImport = (type: TypeImport, desactiver: boolean) => `/api/import/${type}${option(type, desactiver)}`;
export const nomModele = (type: TypeImport) => `modele-${type}.csv`;

/** Vrai si l'aide de l'import doit dire que les montants s'écrivent en centimes : fichier de montants, devise à décimales (EUR…). */
export function aideCentimes(type: TypeImport): boolean {
  return (type === "catalogue" || type === "produits") && deviseActive().decimales > 0;
}

/** « Importer » : un aperçu importable (au moins une ligne, aucune refusée), et aucun envoi en cours. */
export function peutImporter(apercu: ApercuImport | null, pending: boolean): boolean {
  return apercu !== null && apercu.importable && !pending;
}

/** Compteurs de l'aperçu utiles à chaque type : lignes et ajouts toujours, le reste selon l'import. */
export function compteurs(a: ApercuImport): [Key, number][] {
  const liste: [Key, number][] = [["import.lignes", a.lignes], ["import.ajouts", a.ajouts]];
  if (a.type !== "rendez-vous") liste.push(["import.mises_a_jour", a.mises_a_jour]);
  if (a.type === "clientes" || a.type === "produits") liste.push(["import.inchangees", a.inchangees]);
  if (a.type === "produits") liste.push(["import.stocks_changes", a.stocks_changes]);
  if (a.type === "catalogue" && a.desactivees > 0) liste.push(["import.desactivees", a.desactivees]);
  if (a.type === "rendez-vous") liste.push(["import.clientes_creees", a.clientes_creees]);
  return liste;
}

/**
 * Bilan après import : seulement les compteurs qui ont un sens pour le type, chacun une base de pluriel
 * (« 1 ajout », « 2 ajouts »). Ce n'est pas `compteurs`, dont les libellés disent ce qui est « à » faire.
 */
export function compteursBilan(a: ApercuImport): [PluralBase, number][] {
  switch (a.type) {
    case "rendez-vous": return [["import.bilan_ajoutes", a.ajouts], ["import.bilan_clientes_creees", a.clientes_creees]];
    case "produits": return [["import.bilan_ajoutes", a.ajouts], ["import.bilan_mis_a_jour", a.mises_a_jour], ["import.bilan_stocks", a.stocks_changes]];
    case "clientes": return [["import.bilan_ajoutes", a.ajouts], ["import.bilan_completees", a.mises_a_jour]];
    case "catalogue": return [["import.bilan_ajoutes", a.ajouts], ["import.bilan_mis_a_jour", a.mises_a_jour], ["import.bilan_desactivees", a.desactivees]];
  }
}
