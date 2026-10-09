/**
 * Sous-projet 5, vague 3b (spec § 3.1, § 3.2, § 3.3, § 6.2) : acomptes. Un
 * reçu d'acompte (`deposits`, série AC) est pris sur un rendez-vous à venir ;
 * ses versements sont des lignes de `payments` qui citent `deposit_id` (jamais
 * une facture) : positifs à l'encaissement, négatifs au remboursement. Les
 * déclencheurs tiennent, même en SQL direct : numéro AC pris dans sa suite,
 * sans trou ; reçu immuable, sauf le seul passage de `held` à `applied`
 * (déduit d'une facture du même rendez-vous), `refunded` ou `kept` (motif
 * obligatoire), une fois ; un seul acompte en attente par rendez-vous ;
 * versements d'un acompte jamais au-delà de son montant, remboursements
 * seulement pour un acompte remboursé. Correctif 1 (relecture) : un `INSERT`
 * ou `UPDATE OR REPLACE` ne peut pas effacer un reçu en silence par un
 * conflit d'unicité que `deposits_reecriture`/`deposits_immuables` ne
 * surveillaient pas (acompte `held` du même rendez-vous, `settle_request_id`
 * d'un autre reçu) : désormais détecté et refusé avant tout conflit, et une
 * insertion ne peut jamais porter un sort (`settle_request_id`, `settled_by`,
 * `applied_invoice_id`, `settle_reason`) déjà rempli. Les clôtures de caisse
 * gagnent `last_payment_id` : elles délimitent les mouvements d'acompte par
 * l'identifiant du versement, comme les factures par le leur (`cloture.ts`).
 */
export default `
CREATE TABLE deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  series TEXT NOT NULL CHECK (series = 'AC'),
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id),
  client_id INTEGER REFERENCES clients(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  issued_at INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'applied', 'refunded', 'kept')),
  applied_invoice_id INTEGER REFERENCES invoices(id),
  settled_at INTEGER,
  settled_by INTEGER REFERENCES accounts(id),
  settle_reason TEXT NOT NULL DEFAULT '',
  settle_request_id TEXT UNIQUE,
  fiscal TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('fr', 'en')),
  request_id TEXT NOT NULL UNIQUE,
  UNIQUE (series, year, seq),
  CHECK ((status = 'held') = (settled_at IS NULL)),
  CHECK ((status = 'applied') = (applied_invoice_id IS NOT NULL)),
  CHECK (status <> 'kept' OR trim(settle_reason) <> '')
);
CREATE INDEX deposits_appointment ON deposits(appointment_id);
CREATE INDEX deposits_invoice ON deposits(applied_invoice_id);
CREATE UNIQUE INDEX deposits_un_en_attente ON deposits(appointment_id) WHERE status = 'held';
CREATE INDEX payments_deposit ON payments(deposit_id);

ALTER TABLE cash_closings ADD COLUMN last_payment_id INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER deposits_numero BEFORE INSERT ON deposits
WHEN NEW.seq IS NOT (SELECT last FROM sequences WHERE series = NEW.series AND year = NEW.year)
  OR NEW.number <> printf('%s-%d-%06d', NEW.series, NEW.year, NEW.seq)
  OR (NEW.seq <> 1 AND NOT EXISTS (SELECT 1 FROM deposits WHERE series = NEW.series AND year = NEW.year AND seq = NEW.seq - 1))
  OR NEW.status <> 'held'
  OR NEW.settle_request_id IS NOT NULL OR NEW.settled_by IS NOT NULL OR NEW.applied_invoice_id IS NOT NULL OR trim(NEW.settle_reason) <> ''
BEGIN SELECT RAISE(ABORT, 'Numéro de reçu d''acompte hors de sa suite.'); END;

CREATE TRIGGER deposits_reecriture BEFORE INSERT ON deposits
WHEN EXISTS (SELECT 1 FROM deposits WHERE id = NEW.id)
  OR EXISTS (SELECT 1 FROM deposits WHERE number = NEW.number)
  OR EXISTS (SELECT 1 FROM deposits WHERE request_id = NEW.request_id)
  OR EXISTS (SELECT 1 FROM deposits WHERE series = NEW.series AND year = NEW.year AND seq = NEW.seq)
  OR EXISTS (SELECT 1 FROM deposits WHERE appointment_id = NEW.appointment_id AND status = 'held')
BEGIN SELECT RAISE(ABORT, 'Un reçu d''acompte ne se modifie pas.'); END;

CREATE TRIGGER deposits_gardes BEFORE DELETE ON deposits
BEGIN SELECT RAISE(ABORT, 'Un reçu d''acompte ne se supprime pas.'); END;

CREATE TRIGGER deposits_immuables BEFORE UPDATE ON deposits
WHEN OLD.status <> 'held' OR NEW.status NOT IN ('applied', 'refunded', 'kept')
  OR NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.series IS NOT OLD.series OR NEW.year IS NOT OLD.year
  OR NEW.seq IS NOT OLD.seq OR NEW.appointment_id IS NOT OLD.appointment_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.amount IS NOT OLD.amount OR NEW.issued_at IS NOT OLD.issued_at OR NEW.account_id IS NOT OLD.account_id
  OR NEW.fiscal IS NOT OLD.fiscal OR NEW.lang IS NOT OLD.lang OR NEW.request_id IS NOT OLD.request_id
  OR NEW.settled_by IS NULL OR NEW.settle_request_id IS NULL
  OR EXISTS (SELECT 1 FROM deposits WHERE settle_request_id = NEW.settle_request_id AND id <> OLD.id)
BEGIN SELECT RAISE(ABORT, 'Un reçu d''acompte ne se modifie pas.'); END;

CREATE TRIGGER deposits_deduit BEFORE UPDATE ON deposits
WHEN NEW.status = 'applied' AND NOT EXISTS (
  SELECT 1 FROM invoices WHERE id = NEW.applied_invoice_id AND kind = 'invoice' AND appointment_id = NEW.appointment_id)
BEGIN SELECT RAISE(ABORT, 'Acompte déduit d''une facture d''un autre rendez-vous.'); END;

CREATE TRIGGER payments_acompte BEFORE INSERT ON payments
WHEN NEW.deposit_id IS NOT NULL AND (
  NEW.invoice_id IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM deposits WHERE id = NEW.deposit_id)
  OR NEW.amount = 0
  OR (NEW.amount > 0 AND ((SELECT status FROM deposits WHERE id = NEW.deposit_id) <> 'held'
      OR NEW.amount + (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE deposit_id = NEW.deposit_id AND amount > 0)
        > (SELECT amount FROM deposits WHERE id = NEW.deposit_id)))
  OR (NEW.amount < 0 AND ((SELECT status FROM deposits WHERE id = NEW.deposit_id) <> 'refunded'
      OR -NEW.amount - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE deposit_id = NEW.deposit_id AND amount < 0)
        > (SELECT amount FROM deposits WHERE id = NEW.deposit_id))))
BEGIN SELECT RAISE(ABORT, 'Versement d''acompte incohérent.'); END;
`;
