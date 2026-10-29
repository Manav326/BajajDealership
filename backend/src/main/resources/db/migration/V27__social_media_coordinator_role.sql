-- A narrowly scoped staff role can operate the dealership's shared social channels.
-- It deliberately cannot connect/disconnect the dealership's Meta accounts.
insert into role (code, display_name)
values ('SOCIAL_MEDIA_COORDINATOR', 'Social Media Coordinator')
on conflict (code) do update set display_name = excluded.display_name;

insert into role_permission (role_id, permission_id)
select r.id, p.id
from role r
cross join permission p
where r.code = 'SOCIAL_MEDIA_COORDINATOR'
  and p.code in (
    'social_media.read',
    'social_media.publish',
    'social_media.whatsapp.read',
    'social_media.whatsapp.manage',
    'social_media.whatsapp.send'
  )
on conflict do nothing;
