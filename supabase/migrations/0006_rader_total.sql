-- Dagens alla plockade rader används som nämnare för avvikelsegrad.
-- Äldre poster får zon-summan som reservvärde och blir helt korrekta när deras
-- rader-rapport importeras på nytt.
alter table rader add column if not exists total integer;

update rader
set total = coalesce(zon1, 0) + coalesce(zon2, 0) + coalesce(zon3, 0)
where total is null;

alter table rader alter column total set default 0;
alter table rader alter column total set not null;
