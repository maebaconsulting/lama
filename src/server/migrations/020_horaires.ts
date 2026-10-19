/**
 * Horaires et prestations pratiquées (réservation en ligne, spec du 16/10/2026 § 4.1) :
 * semaine type de la praticienne (`NULL` = comme l'institut), case « Réservable en ligne »
 * sur les praticiennes et les prestations (décochée), et liste des prestations pratiquées.
 * Par défaut, tout le monde pratique tout, aujourd'hui comme pour les fiches créées ensuite
 * (déclencheurs) : au comptoir, rien ne change.
 */
export default `
ALTER TABLE staff ADD COLUMN horaires TEXT;
ALTER TABLE staff ADD COLUMN en_ligne INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN en_ligne INTEGER NOT NULL DEFAULT 0;

CREATE TABLE staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);
CREATE INDEX idx_staff_services_service ON staff_services(service_id);

INSERT INTO staff_services (staff_id, service_id) SELECT st.id, se.id FROM staff st CROSS JOIN services se;

CREATE TRIGGER staff_services_nouveau_membre AFTER INSERT ON staff
BEGIN INSERT OR IGNORE INTO staff_services (staff_id, service_id) SELECT NEW.id, id FROM services; END;

CREATE TRIGGER staff_services_nouvelle_prestation AFTER INSERT ON services
BEGIN INSERT OR IGNORE INTO staff_services (staff_id, service_id) SELECT id, NEW.id FROM staff; END;
`;
