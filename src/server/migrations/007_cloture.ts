/**
 * Sous-projet 5, vague 3a (spec § 3.1, § 6.3) : clôtures de caisse. Une
 * clôture couvre les documents de son jour (heure de Douala) dont
 * l'identifiant (`invoices.id`, croissant) est supérieur au
 * `last_invoice_id` de la clôture précédente du même jour (0 pour la
 * première) et au plus égal au sien ; `last_invoice_id` est le plus grand
 * identifiant de facture existant au moment de la clôture, figé dans sa
 * transaction. Les périodes se délimitent ainsi par l'identifiant, jamais
 * par `issued_at` : une vente dont l'heure est figée avant des `await` puis
 * écrite après une clôture passée entre les deux ne peut plus disparaître
 * d'un résumé déjà calculé. `seq` numérote les clôtures dans la journée,
 * sans trou ; `period_start` et `closed_at` ne servent plus qu'à l'affichage
 * (ticket, écran). Elle enregistre le résumé attendu (JSON : totaux par
 * moyen, nombres, pourboires dus), les espèces attendues et comptées,
 * l'écart, la note et la personne. `request_id` rend l'envoi idempotent
 * (double appui). Comme une facture, une clôture ne se modifie ni ne se
 * supprime, même en SQL direct, y compris par `INSERT OR REPLACE` sur son
 * `request_id` ou son `(day, seq)`.
 */
export default `
CREATE TABLE cash_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  seq INTEGER NOT NULL,
  closed_at INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  last_invoice_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  expected TEXT NOT NULL,
  cash_expected INTEGER NOT NULL,
  cash_counted INTEGER NOT NULL CHECK (cash_counted >= 0),
  difference INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL UNIQUE,
  UNIQUE (day, seq),
  CHECK (difference = cash_counted - cash_expected)
);
CREATE INDEX cash_closings_day ON cash_closings(day);

CREATE TRIGGER cash_closings_suite BEFORE INSERT ON cash_closings
WHEN NEW.seq <> 1 + (SELECT COUNT(*) FROM cash_closings WHERE day = NEW.day)
BEGIN SELECT RAISE(ABORT, 'Numéro de clôture hors de sa suite.'); END;
CREATE TRIGGER cash_closings_immuables BEFORE UPDATE ON cash_closings
BEGIN SELECT RAISE(ABORT, 'Une clôture de caisse ne se modifie pas.'); END;
CREATE TRIGGER cash_closings_gardees BEFORE DELETE ON cash_closings
BEGIN SELECT RAISE(ABORT, 'Une clôture de caisse ne se supprime pas.'); END;
CREATE TRIGGER cash_closings_reecriture BEFORE INSERT ON cash_closings
WHEN EXISTS (SELECT 1 FROM cash_closings WHERE id = NEW.id)
  OR EXISTS (SELECT 1 FROM cash_closings WHERE request_id = NEW.request_id)
  OR EXISTS (SELECT 1 FROM cash_closings WHERE day = NEW.day AND seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'Une clôture de caisse ne se modifie pas.'); END;
`;
