-- Enforce dealership ownership at the relational boundary as well as in service-layer authorization.
-- This migration is additive so existing development data is not silently rewritten.

alter table staff_user add constraint uq_staff_dealership_id unique (dealership_id, id);
alter table customer add constraint uq_customer_dealership_id unique (dealership_id, id);
alter table vehicle_model add constraint uq_vehicle_model_dealership_id unique (dealership_id, id);
alter table vehicle_unit add constraint uq_vehicle_unit_dealership_id unique (dealership_id, id);
alter table notification_template add constraint uq_notification_template_dealership_id unique (dealership_id, id);
alter table notification_campaign add constraint uq_notification_campaign_dealership_id unique (dealership_id, id);
alter table notification_recipient add constraint uq_notification_recipient_dealership_id unique (dealership_id, id);
alter table notification_device_registration add constraint uq_notification_device_dealership_id unique (dealership_id, id);

-- Nullable model attributes must not bypass variant uniqueness.
create unique index uq_vehicle_model_variant_normalized
  on vehicle_model (
    dealership_id, model_code,
    coalesce(variant_name, ''),
    coalesce(colour_name, ''),
    coalesce(model_year, 0)
  );

alter table vehicle_unit
  add constraint fk_vehicle_unit_model_same_dealership
  foreign key (dealership_id, vehicle_model_id)
  references vehicle_model (dealership_id, id);

alter table customer_vehicle
  add constraint fk_customer_vehicle_customer_same_dealership
    foreign key (dealership_id, customer_id)
    references customer (dealership_id, id),
  add constraint fk_customer_vehicle_unit_same_dealership
    foreign key (dealership_id, vehicle_unit_id)
    references vehicle_unit (dealership_id, id),
  add constraint fk_customer_vehicle_staff_same_dealership
    foreign key (dealership_id, linked_by_staff_user_id)
    references staff_user (dealership_id, id);

alter table staff_user_role add column dealership_id bigint;
update staff_user_role assigned
set dealership_id = staff.dealership_id
from staff_user staff
where staff.id = assigned.staff_user_id;
alter table staff_user_role alter column dealership_id set not null;
alter table staff_user_role
  add constraint fk_staff_role_member_same_dealership
    foreign key (dealership_id, staff_user_id)
    references staff_user (dealership_id, id),
  add constraint fk_staff_role_assigner_same_dealership
    foreign key (dealership_id, assigned_by_staff_user_id)
    references staff_user (dealership_id, id);

alter table audit_event
  add constraint fk_audit_actor_staff_same_dealership
    foreign key (dealership_id, actor_staff_user_id)
    references staff_user (dealership_id, id),
  add constraint fk_audit_actor_customer_same_dealership
    foreign key (dealership_id, actor_customer_id)
    references customer (dealership_id, id);

alter table notification_template
  add constraint fk_notification_template_creator_same_dealership
    foreign key (dealership_id, created_by_staff_user_id)
    references staff_user (dealership_id, id),
  add constraint fk_notification_template_updater_same_dealership
    foreign key (dealership_id, updated_by_staff_user_id)
    references staff_user (dealership_id, id);

alter table notification_campaign
  add constraint fk_notification_campaign_creator_same_dealership
    foreign key (dealership_id, created_by_staff_user_id)
    references staff_user (dealership_id, id),
  add constraint fk_notification_campaign_template_same_dealership
    foreign key (dealership_id, template_id)
    references notification_template (dealership_id, id);

alter table notification_recipient
  add constraint fk_notification_recipient_campaign_same_dealership
    foreign key (dealership_id, campaign_id)
    references notification_campaign (dealership_id, id),
  add constraint fk_notification_recipient_customer_same_dealership
    foreign key (dealership_id, customer_id)
    references customer (dealership_id, id),
  add constraint fk_notification_recipient_staff_same_dealership
    foreign key (dealership_id, staff_user_id)
    references staff_user (dealership_id, id);

alter table notification_device_registration
  add constraint fk_notification_device_customer_same_dealership
    foreign key (dealership_id, customer_id)
    references customer (dealership_id, id),
  add constraint fk_notification_device_staff_same_dealership
    foreign key (dealership_id, staff_user_id)
    references staff_user (dealership_id, id);

alter table notification_delivery_attempt add column dealership_id bigint;
update notification_delivery_attempt attempt
set dealership_id = recipient.dealership_id
from notification_recipient recipient
where recipient.id = attempt.recipient_id;
alter table notification_delivery_attempt alter column dealership_id set not null;
alter table notification_delivery_attempt
  add constraint fk_notification_attempt_recipient_same_dealership
    foreign key (dealership_id, recipient_id)
    references notification_recipient (dealership_id, id),
  add constraint fk_notification_attempt_device_same_dealership
    foreign key (dealership_id, device_registration_id)
    references notification_device_registration (dealership_id, id);

alter table notification_media_asset
  add constraint fk_notification_media_creator_same_dealership
    foreign key (dealership_id, created_by_staff_user_id)
    references staff_user (dealership_id, id);

alter table notification_audit
  add constraint fk_notification_audit_actor_same_dealership
    foreign key (dealership_id, actor_staff_user_id)
    references staff_user (dealership_id, id),
  add constraint fk_notification_audit_campaign_same_dealership
    foreign key (dealership_id, campaign_id)
    references notification_campaign (dealership_id, id),
  add constraint fk_notification_audit_template_same_dealership
    foreign key (dealership_id, template_id)
    references notification_template (dealership_id, id);
