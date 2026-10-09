/**
 * Impression directe des tickets (spec du 03/10/2026, § 2) : nombre
 * d'impressions réussies de chaque facture, avoir (`invoices`) et reçu
 * d'acompte (`deposits`). La première est l'original ; les suivantes portent
 * « DUPLICATA ». Table à part : factures et reçus restent immuables
 * (déclencheurs des migrations 005 et 008), le compteur n'est pas une donnée fiscale.
 */
export default `
CREATE TABLE print_counts (
  doc TEXT NOT NULL CHECK (doc IN ('invoices', 'deposits')),
  doc_id INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (doc, doc_id)
) WITHOUT ROWID;
`;
