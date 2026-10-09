import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { useAuth } from "../auth-context";
import { useApp } from "../context";
import { useRefresh } from "../hooks/use-refresh";
import { useI18n } from "@/i18n/provider";
import { offlineText } from "../lib/libelles";
import { canSeeBackupStatus, canSeeManual, canSeeOutbox } from "../lib/roles";
import { sessionAlert, type WhatsappStatus } from "../lib/whatsapp";
import { pathFor } from "../lib/routes";
import { bandeauHeure, dernierEcart, voitHeure, type EtatHeure } from "../lib/heure";
import { activerNouvelleVersion, nouvelleVersionVisible, onNouvelleVersion } from "../lib/mise-a-jour";
import { onJoignable, reessayer, serveurJoignable } from "../lib/joignable";
import { ALL_KEYS } from "../lib/realtime";
import { emitRefresh } from "../lib/refresh-bus";
import { BandeauInstallation } from "./installer-lama";
import { useFormation } from "../formation-context";
import { useDemo } from "../demo-context";

const BACKUP_POLL_MS = 10 * 60_000;
/** Session WhatsApp : relue chaque minute, son état ne passe par aucun signal du serveur quand rien ne part. */
const WHATSAPP_POLL_MS = 60_000;
/** Heure du serveur : relue chaque minute (l'en-tête Date de chaque réponse tient l'écart à jour). */
const HEURE_POLL_MS = 60_000;

/**
 * Base de formation (distribution D-18) : bandeau permanent, jamais refermé, d'un bleu nuit que ne prend
 * aucun autre bandeau ; forme courte sur téléphone.
 */
function BandeauFormation() {
  const { t } = useI18n();
  // Démonstration publique (démo publique DP-04) : même bandeau, même couleur, ses propres mots.
  const demo = useDemo() !== null;
  return (
    <div role="status" className="hors-panneau @container border-b border-filet bg-[#2E3A5C] px-4 py-2 text-sm text-[#FBF9F4]">
      <span className="@md:hidden">{t(demo ? "demo.bandeau_court" : "formation.bandeau_court")}</span>
      <span className="hidden @md:inline">{t(demo ? "demo.bandeau" : "formation.bandeau")}</span>
    </div>
  );
}

/**
 * Nouvelle version de lama prête (PWA, P-05) : rechargée seulement sur appui, jamais en pleine saisie ;
 * sans appui, elle est prise au prochain lancement.
 */
function BandeauNouvelleVersion() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(nouvelleVersionVisible);
  useEffect(() => {
    const fin = onNouvelleVersion(setVisible);
    // Un changement tombé entre le rendu et l'effet n'a prévenu personne : l'état courant est relu.
    setVisible(nouvelleVersionVisible());
    return fin;
  }, []);
  if (!visible) return null;
  return (
    <div role="status" className="hors-panneau border-b border-filet bg-muted px-4 py-2 text-sm text-foreground">
      <p className="flex flex-wrap items-center gap-x-2">
        <span>{t("bandeau.nouvelle_version")}</span>
        <button type="button" className="-my-2 inline-flex min-h-11 items-center underline" onClick={activerNouvelleVersion}>{t("bandeau.recharger")}</button>
      </p>
    </div>
  );
}

/**
 * Serveur injoignable (PWA, P-04) : ce qui reste à l'écran date de la dernière réponse, et le bandeau le dit ;
 * « Réessayer » interroge le serveur et, s'il répond, tous les écrans relisent leurs données.
 */
function BandeauInjoignable() {
  const { t } = useI18n();
  const [joignable, setJoignable] = useState(serveurJoignable);
  useEffect(() => {
    const fin = onJoignable(setJoignable);
    setJoignable(serveurJoignable());
    return fin;
  }, []);
  if (joignable) return null;
  return (
    <div role="alert" className="hors-panneau @container border-b border-encre-rouge px-4 py-2 text-sm text-encre-rouge">
      <p className="flex items-center gap-2 @md:block">
        <span className="min-w-0 flex-1">
          <span className="@md:hidden">{t("bandeau.injoignable_court")}</span>
          <span className="hidden @md:inline">{t("bandeau.injoignable")}</span>
        </span>
        {" "}
        <button
          type="button"
          className="-my-2 inline-flex min-h-11 shrink-0 items-center underline @md:my-0"
          onClick={() => void reessayer(() => api("GET", "/api/auth/state"), () => emitRefresh(ALL_KEYS))}
        >
          {t("etat.reessayer")}
        </button>
      </p>
    </div>
  );
}

/**
 * Bandeaux en tête de page : serveur hors ligne (spec 2 § 5), sauvegardes en retard (spec 2 § 7), session WhatsApp tombée (spec 7 § 4),
 * heure du serveur décalée ou caisse bloquée par une heure qui recule (distribution D-11, D-13).
 */
export function Bandeaux() {
  const { account } = useAuth();
  const { navigate } = useApp();
  const { t, lang } = useI18n();
  const role = account.role;
  const formation = useFormation();
  const [file, setFile] = useState<{ online: boolean; pending: number } | null>(null);
  const [alerte, setAlerte] = useState(false);
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const [heure, setHeure] = useState<{ etat: EtatHeure; ecart: number | null; vu: number } | null>(null);

  const charger = useCallback(() => {
    if (canSeeOutbox(role)) {
      api<{ online: boolean; pending: number }>("GET", "/api/outbox?status=pending").then((r) => setFile({ online: r.online, pending: r.pending }), () => undefined);
    }
    if (canSeeBackupStatus(role)) {
      api<{ alert: boolean }>("GET", "/api/backups/status").then((r) => setAlerte(r.alert), () => undefined);
    }
  }, [role]);

  useEffect(() => {
    charger();
    const timer = setInterval(charger, BACKUP_POLL_MS);
    return () => clearInterval(timer);
  }, [charger]);

  // Le travailleur signale « outbox » à chaque changement de connexion et à chaque envoi traité.
  useRefresh(["outbox"], charger);

  const chargerWhatsapp = useCallback(() => {
    if (canSeeManual(role)) api<WhatsappStatus>("GET", "/api/whatsapp/status").then(setWhatsapp, () => undefined);
  }, [role]);
  useEffect(() => {
    chargerWhatsapp();
    const timer = setInterval(chargerWhatsapp, WHATSAPP_POLL_MS);
    return () => clearInterval(timer);
  }, [chargerWhatsapp]);
  useRefresh(["outbox", "settings"], chargerWhatsapp);

  // Administrateur et gérante (D-11) : écart lu sur l'en-tête Date, caisse bloquée lue sur /api/heure.
  const chargerHeure = useCallback(() => {
    if (voitHeure(role)) api<EtatHeure>("GET", "/api/heure").then((etat) => setHeure({ etat, ecart: dernierEcart(), vu: Date.now() }), () => undefined);
  }, [role]);
  useEffect(() => {
    chargerHeure();
    const timer = setInterval(chargerHeure, HEURE_POLL_MS);
    return () => clearInterval(timer);
  }, [chargerHeure]);
  // Une facture, un avoir ou un acompte émis change la dernière facture.
  useRefresh(["invoices"], chargerHeure);
  const texteHeure = heure ? bandeauHeure(heure.etat, heure.ecart, heure.vu, lang) : null;

  const sauvegardes = pathFor("reglages", lang, "sauvegardes");
  const reglagesWhatsapp = pathFor("reglages", lang, "whatsapp");
  const reglagesHeure = pathFor("reglages", lang, "heure");
  return (
    <>
      <BandeauInjoignable />
      {formation && <BandeauFormation />}
      <BandeauNouvelleVersion />
      <BandeauInstallation />
      {texteHeure && (
        // L'administrateur corrige l'heure dans Réglages, Heure ; la gérante sait qui prévenir.
        <div role="alert" className="hors-panneau @container border-b border-encre-rouge px-4 py-2 text-sm text-encre-rouge">
          <p className="flex items-center gap-2 @md:block">
            {/* Pas de coupure : la consigne doit rester lisible en entier, quitte à passer sur deux lignes. */}
            <span className="min-w-0 flex-1">
              <span className="@md:hidden">{role === "admin" ? texteHeure.court : texteHeure.gerante}</span>
              <span className="hidden @md:inline">{texteHeure.long}{role !== "admin" && <>{" "}{t("bandeau.prevenir_admin")}</>}</span>
            </span>
            {role === "admin" && (
              <>{" "}<a className="-my-2 inline-flex min-h-11 shrink-0 items-center underline @md:my-0" href={reglagesHeure} onClick={(e) => { e.preventDefault(); navigate(reglagesHeure); }}>{t("bandeau.voir_heure")}</a></>
            )}
          </p>
        </div>
      )}
      {file && !file.online && (
        <div role="status" className="hors-panneau border-b border-filet bg-muted px-4 py-2 text-sm text-foreground">{offlineText(file.pending, lang)}</div>
      )}
      {alerte && (
        // Bandeau de moins de 28 rem (téléphone) : une seule ligne, forme courte coupée proprement, pour laisser la place au pavé de la caisse ;
        // le lien garde sa cible de 44 px sans grandir le bandeau. Plus large : le texte entier.
        <div role="alert" className="hors-panneau @container border-b border-encre-rouge px-4 py-2 text-sm text-encre-rouge">
          <p className="flex items-center gap-2 @md:block">
            <span className="min-w-0 flex-1 truncate @md:whitespace-normal">
              <span className="@md:hidden">{t("bandeau.sauvegarde_court")}</span>
              <span className="hidden @md:inline">{t("bandeau.sauvegarde")}</span>
              {role !== "admin" && (
                // La rubrique Sauvegardes est réservée à l'administrateur : les autres rôles savent à qui le dire.
                <>{" "}{t("bandeau.prevenir_admin")}</>
              )}
            </span>
            {role === "admin" && (
              <>{" "}<a className="-my-2 inline-flex min-h-11 shrink-0 items-center underline @md:my-0" href={sauvegardes} onClick={(e) => { e.preventDefault(); navigate(sauvegardes); }}>{t("bandeau.voir_sauvegardes")}</a></>
            )}
          </p>
        </div>
      )}
      {sessionAlert(whatsapp) && (
        // Gérante et réception (spec 7 § 4) : la gérante va rescanner le QR code, la réception sait qui prévenir.
        <div role="alert" className="hors-panneau @container border-b border-encre-rouge px-4 py-2 text-sm text-encre-rouge">
          <p className="flex items-center gap-2 @md:block">
            <span className="min-w-0 flex-1 truncate @md:whitespace-normal">
              <span className="@md:hidden">{t("bandeau.whatsapp_court")}</span>
              <span className="hidden @md:inline">{t("bandeau.whatsapp")}</span>
              {role !== "manager" && <>{" "}{t("bandeau.prevenir_gerante")}</>}
            </span>
            {role === "manager" && (
              <>{" "}<a className="-my-2 inline-flex min-h-11 shrink-0 items-center underline @md:my-0" href={reglagesWhatsapp} onClick={(e) => { e.preventDefault(); navigate(reglagesWhatsapp); }}>{t("bandeau.voir_whatsapp")}</a></>
            )}
          </p>
        </div>
      )}
    </>
  );
}
