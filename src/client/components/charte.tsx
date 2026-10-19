import type { ComponentChildren } from "preact";
import { MotLama, SigneLama } from "@/components/brand";
import { BoutonDestructif, ChiffreCle, ElementListe, EtatChargement, EtatErreur, EtatVide, ListeComptoir } from "@/components/comptoir";
import { deviseActive } from "../../shared/devise-active.ts";
import { formatPrice } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STAFF_INKS, STATUS_INKS, contrastRatio } from "@/lib/inks";

const IVOIRE = "#F3EEE4";
const FONDATIONS = [
  { nom: "Cuir", hex: "#161514", role: "couverture, texte, boutons principaux" },
  { nom: "Ivoire", hex: "#F3EEE4", role: "fond des pages" },
  { nom: "Papier", hex: "#FBF9F4", role: "fiches, dialogues, étiquettes" },
  { nom: "Encre grise", hex: "#6E6A64", role: "texte secondaire, contours de champs" },
  { nom: "Filet", hex: "#D8D1C4", role: "lignes décoratives du registre" },
  { nom: "Encre rouge", hex: "#7A1F1F", role: "erreurs, suppressions, conflits, annulé" },
];
/** Calculé au rendu : la devise est posée après l'import du module. */
function specimen(): string {
  return "Élégance, À bientôt, Ç, Œ, « Soin éclat », " + formatPrice(15000, "fr");
}

function Section({ titre, children }: { titre: string; children: ComponentChildren }) {
  return (
    <section className="border-t border-filet py-10">
      <h2 className="etiquette mb-6 text-encre-grise">{titre}</h2>
      {children}
    </section>
  );
}

function Nuance({ nom, hex, role }: { nom: string; hex: string; role?: string }) {
  const ratio = contrastRatio(hex, IVOIRE);
  return (
    <div className="flex items-center gap-4 py-2">
      <span className="h-11 w-11 shrink-0 rounded-sm border border-filet" style={{ backgroundColor: hex }} />
      <div className="min-w-0">
        <p className="text-sm">{nom} <span className="text-encre-grise">{hex}</span></p>
        <p className="text-xs text-encre-grise">
          {role ? `${role} · ` : ""}{ratio.toLocaleString("fr-FR")}:1 sur ivoire
        </p>
      </div>
    </div>
  );
}

/** Page de référence de la charte « Le carnet de rendez-vous ». Hors menu : /charte. */
export function Charte() {
  return (
    <div data-theme="light" className="bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <header className="pb-10">
          <h1 className="font-serif text-2xl">Le carnet de rendez-vous</h1>
          <p className="mt-3 max-w-prose text-encre-grise">
            {"Couverture de cuir, pages d'ivoire, filets de registre. La marque lama suit son fond\u00a0: blanche sur le cuir, noire sur le papier, sans or."}
          </p>
        </header>

        <Section titre="Marque">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col items-center gap-4 rounded-sm bg-cuir p-8">
              <SigneLama className="h-16 w-16 text-papier" title="Version blanche, sur cuir" />
              <MotLama className="text-[2.75rem] text-papier" />
              <p className="etiquette text-papier/60">Sur cuir · menu, écran d'entrée</p>
            </div>
            <div className="flex flex-col items-center gap-4 rounded-sm border border-filet bg-papier p-8">
              <SigneLama className="h-16 w-16 text-cuir" title="Version noire, sur papier" />
              <MotLama className="text-[2.75rem] text-cuir" />
              <p className="etiquette text-encre-grise">Sur papier · fiches</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-encre-grise">
            Signe provisoire, remplaçable dans un seul fichier (assets/brand/signe-lama.svg). Les documents de l'institut ne portent pas la marque, seulement « propulsé par lama » en pied.
          </p>
        </Section>

        <Section titre="Couleurs">
          <div className="grid gap-x-8 sm:grid-cols-2">
            {FONDATIONS.map((c) => <Nuance key={c.hex} {...c} />)}
          </div>
        </Section>

        <Section titre="Encres de statut">
          <div className="flex flex-wrap gap-3">
            {Object.keys(STATUS_INKS).map((s) => <StatusBadge key={s} status={s} />)}
          </div>
        </Section>

        <Section titre="Encres de praticiennes">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STAFF_INKS.map((ink) => (
              <div key={ink.hex} className="rounded-sm border border-filet border-l-[3px] bg-papier px-3 py-2" style={{ borderLeftColor: ink.hex }}>
                <p className="chiffres text-sm text-encre-grise">10:00–11:30</p>
                <p className="text-sm">Aïcha Mbarga</p>
                <p className="text-xs text-encre-grise">Soin du visage éclat · {ink.name}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section titre="Typographie">
          <div className="space-y-6">
            <div>
              <p className="etiquette mb-2 text-encre-grise">Cormorant Garamond 300 · le mot lama seulement</p>
              <MotLama className="text-2xl" />
            </div>
            <div>
              <p className="etiquette mb-2 text-encre-grise">EB Garamond · titres, heures, montants</p>
              <p className="font-serif text-2xl">Planning du jour</p>
              <p className="chiffres text-lg">{"09:30 · 14:00 · " + formatPrice(15000, "fr")}</p>
              <p className="font-serif text-base">{specimen()}</p>
            </div>
            <div>
              <p className="etiquette mb-2 text-encre-grise">Jost · interface et données</p>
              <p className="etiquette">Institut de beauté</p>
              <p className="text-base">{specimen()}</p>
              <p className="text-sm text-encre-grise">{"Échelle\u00a0: 0,75 · 0,875 · 1 · 1,375 · 2\u00a0rem"}</p>
            </div>
          </div>
        </Section>

        <Section titre="Boutons">
          <div className="flex flex-wrap gap-3">
            <Button>Nouveau rendez-vous</Button>
            <Button variant="outline">Annuler</Button>
            <Button variant="secondary">Feuille du jour</Button>
            <Button variant="ghost">Retour</Button>
            <Button variant="destructive">Supprimer</Button>
            <Button disabled>Indisponible</Button>
          </div>
        </Section>

        <Section titre="Comptoir">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ChiffreCle valeur={12} libelle="Rendez-vous du jour" />
            <ChiffreCle valeur={4} libelle="À venir" onClick={() => undefined} />
            <ChiffreCle valeur={"185\u202f000"} libelle={`Prévu (${deviseActive().symbole})`} />
            <ChiffreCle valeur={2} libelle="Stock bas" alerte />
          </div>
          <div className="mt-6">
            <ListeComptoir libelle="Exemple de liste">
              <ElementListe titre="Brenda Nkeng" detail="Soin du visage éclat, Aïcha" meta="10:00" badge={<StatusBadge status="confirmed" />} onOpen={() => undefined} actif />
              <ElementListe titre="Ngozi Tabi" detail="Manucure, Mireille" meta="11:30" badge={<StatusBadge status="booked" />} onOpen={() => undefined} />
            </ListeComptoir>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <EtatChargement />
            <EtatVide message="Aucun rendez-vous ce jour-là." action={{ libelle: "Nouveau rendez-vous", onClick: () => undefined }} />
            <EtatErreur message="Serveur injoignable." onRetry={() => undefined} />
          </div>
          <div className="mt-6">
            <BoutonDestructif libelle="Supprimer" question={"Supprimer ce rendez-vous\u00a0?"} onConfirm={() => undefined} />
          </div>
        </Section>

        <Section titre="Champs">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="etiquette text-encre-grise">Nom complet</span>
              <Input placeholder="Aïcha Mbarga" />
            </label>
            <label className="space-y-2">
              <span className="etiquette text-encre-rouge">Téléphone</span>
              <Input aria-invalid="true" className="border-encre-rouge" value="6 77" />
              <span className="text-xs text-encre-rouge">Numéro incomplet</span>
            </label>
            <label className="space-y-2 sm:col-span-2">
              <span className="etiquette text-encre-grise">Notes</span>
              <Textarea rows={2} placeholder="Préférences, allergies…" />
            </label>
          </div>
        </Section>

        <Section titre="Onglets de jours">
          <Tabs defaultValue="dim">
            <TabsList>
              <TabsTrigger value="sam">Sam. 26</TabsTrigger>
              <TabsTrigger value="dim">Dim. 27</TabsTrigger>
              <TabsTrigger value="lun">Lun. 28</TabsTrigger>
            </TabsList>
            <div className="h-16 border border-t-0 border-filet bg-papier" aria-hidden="true" />
          </Tabs>
        </Section>

        <Section titre="Registre">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Heure</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">{`Montant (${deviseActive().symbole})`}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="chiffres-tabulaires">09:30</TableCell>
                <TableCell>Brenda Nkeng</TableCell>
                <TableCell><StatusBadge status="confirmed" /></TableCell>
                <TableCell className="chiffres-tabulaires text-right">{"25\u202f000"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="chiffres-tabulaires">11:00</TableCell>
                <TableCell>Ngozi Tabi</TableCell>
                <TableCell><StatusBadge status="cancelled" /></TableCell>
                <TableCell className="chiffres-tabulaires text-right">{"12\u202f000"}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Section>

        <Section titre="Ticket 80 mm (aperçu)">
          <div className="mx-auto w-[302px] bg-papier px-5 py-6 font-sans text-xs text-cuir ring-1 ring-filet">
            <p className="pb-4 text-center font-serif text-base">Nom de l'institut</p>
            <p className="border-t border-dashed border-cuir pt-2 text-center">FAC-2026-000123 · 27/09/2026 15:40</p>
            <div className="flex justify-between py-2"><span>Soin du visage éclat</span><span className="chiffres">{"25\u202f000"}</span></div>
            <div className="flex justify-between border-t border-dashed border-cuir pt-2 font-medium"><span>Total TTC</span><span className="chiffres">{formatPrice(25000, "fr")}</span></div>
            <p className="pt-3 text-center text-encre-grise">Merci de votre visite, à très bientôt.</p>
            <p className="pt-1 text-center text-[10px] text-encre-grise">propulsé par lama</p>
          </div>
          <p className="mt-3 text-center text-xs text-encre-grise">Données fictives, pour la mise en page seulement.</p>
        </Section>
      </div>
    </div>
  );
}
