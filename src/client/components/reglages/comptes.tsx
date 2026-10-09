import { useState } from "preact/hooks";
import { api } from "../../api";
import { useAuth } from "../../auth-context";
import type { Account, Role } from "../../lib/auth-types";
import { newAccountProblem } from "../../lib/forms";
import { etatCompte } from "../../lib/libelles";
import { accountPatch, accountPatchProblem, type AccountForm } from "../../lib/reglages";
import { isOpen } from "../../lib/fiches";
import { creatableRoles, defaultNewRole, ROLE_KEYS } from "../../lib/roles";
import { useLoad } from "../../hooks/use-load";
import { useApp } from "../../context";
import type { StaffLookup } from "../../types";
import { useI18n } from "@/i18n/provider";
import { LANGS, normalizeLang, type Lang } from "@/i18n/translate";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Champ, Erreur, Succes } from "../champ";
import { useConfirmation } from "../auth/confirmation";
import { ListeFiches, LigneFiche } from "../fiches/liste-fiches";
import { Case, Rubrique, SELECT } from "./elements";

/**
 * Comptes de l'équipe (spec 2 § 3.1), sur le motif des fiches (sous-projet 4
 * § 7.1) : une ligne par compte (cartes au téléphone), toucher la ligne ouvre
 * la fiche du compte dans le panneau, avec Modifier et Débloquer (D5 : plus
 * de bouton hors de l'écran). L'administrateur gère tous les comptes, la
 * gérante ceux des réceptionnistes et des praticiennes ; chacun a sa langue.
 */
export function Comptes() {
  const { account: moi } = useAuth();
  const { panel, openPanel } = useApp();
  const { t, lang } = useI18n();
  const comptes = useLoad(() => api<{ accounts: Account[] }>("GET", "/api/accounts"), ["accounts"]);
  // Seule la gérante voit les fiches de l'équipe (l'administrateur n'a pas accès à l'activité).
  const fiches = useLoad(() => (moi.role === "manager" ? api<{ staff: StaffLookup[] }>("GET", "/api/staff/all") : Promise.resolve({ staff: [] as StaffLookup[] })), ["staff"]);
  const [creation, setCreation] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  const now = Date.now();
  return (
    <Rubrique
      titre={t("reglages.rubrique.comptes")}
      description={moi.role === "admin" ? t("comptes.description_admin") : t("comptes.description_gerante")}
    >
      <div><Button onClick={() => { setOk(null); setCreation(true); }}>{t("comptes.nouveau")}</Button></div>
      <Erreur message={comptes.error} />
      <Succes message={ok} />
      {comptes.data && (
        <div className="@container">
          <ListeFiches libelle={t("reglages.rubrique.comptes")}>
            {comptes.data.accounts.map((a) => {
              const etat = etatCompte(a, now, lang);
              return (
                <LigneFiche
                  key={a.id}
                  titre={a.display_name}
                  detail={`${a.login} · ${t(ROLE_KEYS[a.role])}`}
                  secondaire={t(a.language === "en" ? "langue.nom.en" : "langue.nom.fr")}
                  fin={<span className={etat.alert ? "text-encre-rouge" : "text-muted-foreground"}>{etat.text}</span>}
                  attenue={a.active !== 1}
                  actif={isOpen(panel, "account", a.id)}
                  onOpen={() => openPanel("account", a.id)}
                />
              );
            })}
          </ListeFiches>
        </div>
      )}
      {creation && (
        <Creation
          roles={creatableRoles(moi.role)}
          fiches={fiches.data?.staff ?? []}
          onClose={() => setCreation(false)}
          onDone={async (message) => { setCreation(false); setOk(message); await comptes.reload(); }}
        />
      )}
    </Rubrique>
  );
}

function ChoixFiche({ id, fiches, value, onChange }: { id: string; fiches: StaffLookup[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("comptes.fiche")}</Label>
      <select id={id} className={SELECT} value={value} onChange={(e: Event) => onChange((e.currentTarget as HTMLSelectElement).value)}>
        <option value="">{t("comptes.choisir_fiche")}</option>
        {fiches.map((f) => <option key={f.id} value={String(f.id)}>{f.name}</option>)}
      </select>
    </div>
  );
}

/** Langue d'un compte : français ou anglais. */
function ChoixLangue({ id, value, onChange }: { id: string; value: Lang; onChange: (v: Lang) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("colonne.langue")}</Label>
      <select id={id} className={SELECT} value={value} onChange={(e: Event) => onChange(normalizeLang((e.currentTarget as HTMLSelectElement).value))}>
        {LANGS.map((code) => <option key={code} value={code}>{t(code === "fr" ? "langue.nom.fr" : "langue.nom.en")}</option>)}
      </select>
    </div>
  );
}

function Creation({ roles, fiches, onClose, onDone }: { roles: Role[]; fiches: StaffLookup[]; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const { t } = useI18n();
  const confirm = useConfirmation();
  const [form, setForm] = useState({ display_name: "", login: "", role: defaultNewRole(roles), password: "", confirmation: "", pin: "", staff_id: "", language: "fr" as Lang });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (e: Event) => setForm({ ...form, [key]: (e.currentTarget as HTMLInputElement).value });

  const submit = async (e: Event) => {
    e.preventDefault();
    const problem = newAccountProblem(form);
    if (problem) { setError(t(problem)); return; }
    if (form.role === "practitioner" && !form.staff_id) { setError(t("comptes.fiche_manquante")); return; }
    setPending(true);
    setError(null);
    try {
      const created = await confirm(() => api("POST", "/api/accounts", {
        display_name: form.display_name.trim(), login: form.login.trim(), role: form.role, password: form.password,
        pin: form.role === "admin" ? null : form.pin || null, staff_id: form.role === "practitioner" ? Number(form.staff_id) : null, language: form.language,
      }));
      if (created !== null) await onDone(t("comptes.cree", { nom: form.display_name.trim() }));
    } catch (err) {
      setForm({ ...form, password: "", confirmation: "", pin: "" });
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-dvh overflow-y-auto">
        <DialogTitle>{t("comptes.nouveau")}</DialogTitle>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <Champ id="nc-nom" label={t("compte.nom_affiche")} value={form.display_name} onInput={set("display_name")} />
          <Champ id="nc-identifiant" label={t("connexion.identifiant")} autoCapitalize="none" spellcheck={false} autoComplete="off" value={form.login} onInput={set("login")} />
          <div className="space-y-1.5">
            <Label htmlFor="nc-role">{t("colonne.role")}</Label>
            <select id="nc-role" className={SELECT} value={form.role} onChange={(e: Event) => { const role = (e.currentTarget as HTMLSelectElement).value as Role; setForm({ ...form, role, pin: role === "admin" ? "" : form.pin }); }}>
              {roles.map((r) => <option key={r} value={r}>{t(ROLE_KEYS[r])}</option>)}
            </select>
          </div>
          {form.role === "practitioner" && <ChoixFiche id="nc-fiche" fiches={fiches} value={form.staff_id} onChange={(v) => setForm({ ...form, staff_id: v })} />}
          <ChoixLangue id="nc-langue" value={form.language} onChange={(v) => setForm({ ...form, language: v })} />
          <Champ id="nc-mdp" type="password" label={t("comptes.mot_de_passe_provisoire")} autoComplete="new-password" value={form.password} onInput={set("password")} />
          <Champ id="nc-mdp2" type="password" label={t("compte.mot_de_passe_bis")} autoComplete="new-password" value={form.confirmation} onInput={set("confirmation")} />
          {form.role !== "admin" && <Champ id="nc-pin" type="password" inputMode="numeric" label={t("comptes.pin_facultatif")} autoComplete="off" value={form.pin} onInput={set("pin")} />}
          <Erreur message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
            <Button type="submit" disabled={pending}>{t("comptes.creer")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Modification d'un compte (fenêtre ouverte depuis sa fiche dans le panneau). */
export function Edition({ cible, moi, fiches, onClose, onDone }: { cible: Account; moi: Account; fiches: StaffLookup[]; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const { t } = useI18n();
  const confirm = useConfirmation();
  const [form, setForm] = useState<AccountForm>({
    display_name: cible.display_name, active: cible.active === 1, password: "", pin: "", removePin: false,
    staff_id: cible.staff_id === null ? "" : String(cible.staff_id), language: normalizeLang(cible.language),
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const patch = accountPatch(cible, form);

  const submit = async (e: Event) => {
    e.preventDefault();
    const problem = accountPatchProblem(form);
    if (problem) { setError(t(problem)); return; }
    setPending(true);
    setError(null);
    try {
      const done = await confirm(() => api("PUT", `/api/accounts/${cible.id}`, patch));
      if (done !== null) await onDone(t("comptes.modifie", { nom: form.display_name.trim() }));
    } catch (err) {
      setForm({ ...form, password: "", pin: "" });
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o: boolean) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-dvh overflow-y-auto">
        <DialogTitle>{t("comptes.compte_de", { nom: cible.display_name })}</DialogTitle>
        <form className="space-y-4" onSubmit={submit} noValidate>
          <Champ id="mc-nom" label={t("compte.nom_affiche")} value={form.display_name} onInput={(e: Event) => setForm({ ...form, display_name: (e.currentTarget as HTMLInputElement).value })} />
          {cible.role === "practitioner" && moi.role === "manager" && (
            <ChoixFiche id="mc-fiche" fiches={fiches} value={form.staff_id} onChange={(v) => setForm({ ...form, staff_id: v })} />
          )}
          <ChoixLangue id="mc-langue" value={form.language} onChange={(v) => setForm({ ...form, language: v })} />
          <Case id="mc-actif" label={t("comptes.actif")} checked={form.active} disabled={cible.id === moi.id} onChange={(v) => setForm({ ...form, active: v })} />
          <Champ id="mc-mdp" type="password" label={t("comptes.nouveau_mdp")} autoComplete="new-password" value={form.password} onInput={(e: Event) => setForm({ ...form, password: (e.currentTarget as HTMLInputElement).value })} />
          {cible.role !== "admin" && <Champ id="mc-pin" type="password" inputMode="numeric" label={t("comptes.nouveau_pin")} autoComplete="off" value={form.pin} disabled={form.removePin} onInput={(e: Event) => setForm({ ...form, pin: (e.currentTarget as HTMLInputElement).value })} />}
          {cible.role !== "admin" && cible.has_pin && <Case id="mc-sans-pin" label={t("comptes.retirer_pin")} checked={form.removePin} onChange={(v) => setForm({ ...form, removePin: v })} />}
          <Erreur message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
            <Button type="submit" disabled={pending || Object.keys(patch).length === 0}>{t("commun.enregistrer")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
