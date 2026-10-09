import { useState } from "preact/hooks";
import { useApp } from "../context";
import { useCrm } from "../auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/provider";
import { birthdayParts, birthdayValue, clientPayload, daysInMonth, MAX_PREFERENCES, monthNames, parseTagInput } from "@/lib/crm";
import { nameProblem } from "@/lib/forms";
import type { Client } from "../types";
import { SaisieEtiquettes } from "./fiches/etiquettes";
import { SELECT } from "./reglages/elements";
import { Erreur } from "./champ";

/** Numéro d'exemple au format du Cameroun (sans lettre : identique dans les deux langues). */
const PHONE_EXAMPLE = "+237 6 77 12 34 56";

/**
 * Cliente : création, ou modification de `client` (depuis sa fiche, vague 4).
 * Mini CRM : anniversaire (jour et mois, sans année), étiquettes ; la note et
 * les préférences se saisissent à la création, puis sur place dans la fiche.
 * Mini CRM désactivé (interrupteur général) : ni anniversaire, ni étiquettes,
 * ni préférences, ni à l'écran ni dans l'envoi (le serveur garde les valeurs).
 */
export function CreateClient({ onClose, client }: { onClose: () => void; client?: Client }) {
  const { addClient, updateClient, clientTags } = useApp();
  const { t, lang } = useI18n();
  const crm = useCrm();
  const [name, setName] = useState(client?.name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [preferences, setPreferences] = useState(client?.preferences ?? "");
  const born = birthdayParts(client?.birthday ?? "");
  const [day, setDay] = useState<number | null>(born?.day ?? null);
  const [month, setMonth] = useState<number | null>(born?.month ?? null);
  const [tags, setTags] = useState<string[]>(client?.tags ?? []);
  const [card, setCard] = useState(client?.card ?? "");
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseMonth = (value: number | null) => {
    setMonth(value);
    // Jour ramené au dernier du mois choisi (31 → 30 en avril, 29 en février).
    if (value !== null && day !== null && day > daysInMonth(value)) setDay(daysInMonth(value));
  };

  const handleSubmit = async () => {
    setError(null);
    const problem = nameProblem(name);
    if (problem) { setError(t(problem)); return; }
    if (crm && (day === null) !== (month === null)) { setError(t("crm.anniversaire_incomplet")); return; }
    setSaving(true);
    try {
      // Étiquette encore dans le champ (sans Entrée ni virgule) : ajoutée comme les autres.
      const finalTags = parseTagInput(`${tagDraft},`, tags).tags;
      const data = clientPayload(client
        ? { name: name.trim(), email, phone, birthday: birthdayValue(day, month), tags: finalTags, card: card.trim() }
        : { name: name.trim(), email, phone, notes, preferences: preferences.trim(), birthday: birthdayValue(day, month), tags: finalTags, card: card.trim() }, crm);
      if (client) await updateClient(client.id, data);
      else await addClient(data);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{client ? t("cliente.modifier_titre") : t("cliente.ajouter")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nc-nom-cliente">{t("commun.nom_obligatoire")}</Label>
            <Input id="nc-nom-cliente" value={name} onChange={(e: Event) => setName((e.target as HTMLInputElement).value)} placeholder={t("commun.nom_complet")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nc-email-cliente">{t("colonne.email")}</Label>
              <Input id="nc-email-cliente" type="email" value={email} onChange={(e: Event) => setEmail((e.target as HTMLInputElement).value)} placeholder={t("cliente.email_exemple")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nc-tel-cliente">{t("colonne.telephone")}</Label>
              <Input id="nc-tel-cliente" type="tel" inputMode="tel" value={phone} onChange={(e: Event) => setPhone((e.target as HTMLInputElement).value)} placeholder={PHONE_EXAMPLE} />
            </div>
          </div>
          {crm && (
            <fieldset className="space-y-1.5">
              <legend className="etiquette leading-snug text-encre-grise">{t("crm.anniversaire")}</legend>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
                <select id="nc-jour-cliente" aria-label={t("crm.jour")} className={SELECT} value={day ?? ""} onChange={(e) => setDay(Number((e.currentTarget as HTMLSelectElement).value) || null)}>
                  <option value="">{t("crm.jour")}</option>
                  {Array.from({ length: month ? daysInMonth(month) : 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select id="nc-mois-cliente" aria-label={t("crm.mois")} className={SELECT} value={month ?? ""} onChange={(e) => chooseMonth(Number((e.currentTarget as HTMLSelectElement).value) || null)}>
                  <option value="">{t("crm.mois")}</option>
                  {monthNames(lang).map((nom, i) => <option key={nom} value={i + 1}>{nom}</option>)}
                </select>
                <Button variant="outline" aria-label={t("crm.effacer_anniversaire")} disabled={day === null && month === null} onClick={() => { setDay(null); setMonth(null); }}>
                  {t("crm.effacer")}
                </Button>
              </div>
            </fieldset>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="nc-carte-cliente">{t("crm.carte")}</Label>
            <Input id="nc-carte-cliente" value={card} autoComplete="off" maxLength={40} onChange={(e: Event) => setCard((e.target as HTMLInputElement).value)} />
            <p className="text-xs text-muted-foreground">{t("crm.carte_aide")}</p>
          </div>
          {crm && (
            <div className="space-y-1.5">
              <Label htmlFor="nc-etiquettes-cliente">{t("crm.etiquettes")}</Label>
              <SaisieEtiquettes id="nc-etiquettes-cliente" tags={tags} onChange={setTags} draft={tagDraft} onDraft={setTagDraft} existing={clientTags} />
            </div>
          )}
          {crm && !client && (
            <div className="space-y-1.5">
              <Label htmlFor="nc-preferences-cliente">{t("crm.preferences")}</Label>
              <Textarea id="nc-preferences-cliente" rows={2} maxLength={MAX_PREFERENCES} value={preferences} onChange={(e: Event) => setPreferences((e.target as HTMLTextAreaElement).value)} placeholder={t("crm.preferences_exemple")} />
            </div>
          )}
          {!client && (
            <div className="space-y-1.5">
              <Label htmlFor="nc-notes-cliente">{t("cliente.note")}</Label>
              <Textarea id="nc-notes-cliente" rows={2} value={notes} onChange={(e: Event) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder={t("cliente.notes_exemple")} />
            </div>
          )}
        </div>
        <Erreur message={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("commun.annuler")}</Button>
          <Button disabled={saving} onClick={handleSubmit}>{saving ? t("commun.enregistrement") : client ? t("commun.enregistrer_modifications") : t("cliente.ajouter")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
