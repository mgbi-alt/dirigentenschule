-- ============================================================
--  Migration v15 – Treffen als Wochenend-Paket (welche Tage)
--  Nach v14 ausführen (idempotent).
--  tage: 'fr_sa' (Freitag+Samstag, Standard) | 'fr' (nur Freitag, Zusatz) | 'sa' (nur Samstag)
-- ============================================================
alter table plans add column if not exists tage text default 'fr_sa';
update plans set tage='fr_sa' where tage is null;
