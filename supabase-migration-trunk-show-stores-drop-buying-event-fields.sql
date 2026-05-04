-- Drop the Trunk Show Details buying-event fields from
-- trunk_show_stores. The whole "Trunk Show Details" section was
-- removed from the admin UI; these columns are no longer read or
-- written anywhere.
ALTER TABLE public.trunk_show_stores
  DROP COLUMN IF EXISTS aframe_buying_event,
  DROP COLUMN IF EXISTS counter_card_buying_event,
  DROP COLUMN IF EXISTS buying_event_questionnaire;
