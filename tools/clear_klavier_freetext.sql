-- Einmal-Skript: Klavierbegleitung-Freitext (timetable.klavier) in ALLEN Plänen leeren.
-- Die per Dropdown verknüpften Begleiter (timetable.klavier_ids) bleiben erhalten.
update timetable set klavier = null where klavier is not null;
