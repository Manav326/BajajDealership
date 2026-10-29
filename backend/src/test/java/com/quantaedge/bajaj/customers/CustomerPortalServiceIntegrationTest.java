package com.quantaedge.bajaj.customers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.CustomerPrincipal;
import com.quantaedge.bajaj.security.StaffPrincipal;
import com.quantaedge.bajaj.security.TokenDigests;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class CustomerPortalServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private CustomerService customers;
  @Autowired private CustomerPortalService portal;

  @Test
  void invitationActivationLoginAndSingleUseRulesAreEnforced() {
    Fixture fixture = createFixture("AUTH");
    var invitation = portal.issueInvitation(fixture.owner(), fixture.customerPublicId());
    assertThat(invitation.purpose()).isEqualTo("SETUP");
    assertThat(invitation.activationToken()).hasSizeGreaterThanOrEqualTo(32);
    assertThat(invitation.expiresAt()).isAfter(Instant.now());

    var activated = portal.activate(
        new CustomerPortalService.ActivationRequest(invitation.activationToken(), "Strong-Customer-Password-123"),
        "203.0.113.10", "portal-test-agent");
    assertThat(activated.customer().publicId()).isEqualTo(fixture.customerPublicId());
    assertThat(activated.accessToken()).isNotBlank();
    assertThat(activated.expiresAt()).isAfter(Instant.now());

    assertThatThrownBy(() -> portal.activate(
        new CustomerPortalService.ActivationRequest(invitation.activationToken(), "Another-Strong-Password-456"),
        "203.0.113.10", "portal-test-agent"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED));

    var login = portal.login(new CustomerPortalService.LoginRequest(
        fixture.dealershipCode(), fixture.customerCode(), "Strong-Customer-Password-123"),
        "203.0.113.11", "portal-test-agent");
    assertThat(login.customer().publicId()).isEqualTo(fixture.customerPublicId());
    assertThat(login.accessToken()).isNotEqualTo(activated.accessToken());

    assertThatThrownBy(() -> portal.login(new CustomerPortalService.LoginRequest(
        fixture.dealershipCode(), fixture.customerCode(), "incorrect-password"),
        "203.0.113.11", "portal-test-agent"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED));

    var resetInvitation = portal.issueInvitation(fixture.owner(), fixture.customerPublicId());
    assertThat(resetInvitation.purpose()).isEqualTo("PASSWORD_RESET");
    var resetSession = portal.activate(
        new CustomerPortalService.ActivationRequest(resetInvitation.activationToken(), "New-Customer-Password-789"),
        "203.0.113.12", "portal-test-agent");
    assertThat(resetSession.customer().publicId()).isEqualTo(fixture.customerPublicId());

    Integer oldSessionRevoked = jdbc.queryForObject("""
        select count(*) from customer_portal_session
        where token_hash = ? and revoked_at is not null
        """, Integer.class, TokenDigests.sha256(activated.accessToken()));
    assertThat(oldSessionRevoked).isEqualTo(1);

    var newLogin = portal.login(new CustomerPortalService.LoginRequest(
        fixture.dealershipCode(), fixture.customerCode(), "New-Customer-Password-789"),
        "203.0.113.13", "portal-test-agent");
    assertThat(newLogin.customer().publicId()).isEqualTo(fixture.customerPublicId());
  }

  @Test
  void portalOnlyShowsCurrentlyOwnedVehiclesAndRejectsAppointmentsForAnotherCustomersBike() {
    Fixture ownerFixture = createFixture("OWNER");
    Fixture otherFixture = createFixture("OTHER");
    var ownerInvite = portal.issueInvitation(ownerFixture.owner(), ownerFixture.customerPublicId());
    var session = portal.activate(
        new CustomerPortalService.ActivationRequest(ownerInvite.activationToken(), "Strong-Customer-Password-123"),
        "203.0.113.20", "portal-test-agent");
    CustomerPrincipal principal = principalForToken(session.accessToken());

    var ownedVehicles = portal.vehicles(principal);
    assertThat(ownedVehicles).hasSize(1);
    assertThat(ownedVehicles).extracting(CustomerPortalService.VehicleView::publicId)
        .containsExactly(ownerFixture.vehiclePublicId());
    assertThat(portal.serviceHistory(principal)).isEmpty();

    Instant appointmentStart = Instant.now().plus(Duration.ofDays(2));
    var appointment = portal.createAppointment(principal,
        new CustomerPortalService.CustomerAppointmentRequest(
            ownerFixture.vehiclePublicId(), appointmentStart, 60,
            "Regular service appointment", "en"));
    assertThat(appointment.status()).isEqualTo("REQUESTED");
    assertThat(appointment.source()).isEqualTo("CUSTOMER_WEB");
    assertThat(portal.appointments(principal)).extracting(CustomerPortalService.AppointmentView::publicId)
        .containsExactly(appointment.publicId());

    assertThatThrownBy(() -> portal.createAppointment(principal,
        new CustomerPortalService.CustomerAppointmentRequest(
            otherFixture.vehiclePublicId(), appointmentStart.plusSeconds(7200), 60,
            "Trying to book a bike belonging to another customer", "en")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));

    assertThatThrownBy(() -> portal.cancelAppointment(principal, UUID.randomUUID(), "Guess another appointment id"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));

    assertThatThrownBy(() -> portal.createAppointment(principal,
        new CustomerPortalService.CustomerAppointmentRequest(
            ownerFixture.vehiclePublicId(), appointmentStart.plusSeconds(1800), 60,
            "Conflicting appointment", "en")))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT));

    var cancelled = portal.cancelAppointment(principal, appointment.publicId(), "Customer requested a new date");
    assertThat(cancelled.status()).isEqualTo("CANCELLED");
    assertThat(portal.appointments(principal)).extracting(CustomerPortalService.AppointmentView::status)
        .containsExactly("CANCELLED");
  }

  @Test
  void invitationTokenCanOnlyActivateTheCustomerItWasIssuedFor() {
    Fixture firstAgencyCustomer = createFixture("FIRST");
    Fixture secondAgencyCustomer = createFixture("SECOND");

    var invitation = portal.issueInvitation(secondAgencyCustomer.owner(), secondAgencyCustomer.customerPublicId());
    var session = portal.activate(
        new CustomerPortalService.ActivationRequest(invitation.activationToken(), "Strong-Customer-Password-123"),
        "203.0.113.30", "portal-test-agent");

    assertThat(session.customer().publicId()).isEqualTo(secondAgencyCustomer.customerPublicId());
    assertThat(session.customer().publicId()).isNotEqualTo(firstAgencyCustomer.customerPublicId());
    CustomerPrincipal principal = principalForToken(session.accessToken());
    assertThat(portal.profile(principal).dealershipCode()).isEqualTo(secondAgencyCustomer.dealershipCode());
    assertThat(portal.vehicles(principal)).extracting(CustomerPortalService.VehicleView::publicId)
        .containsExactly(secondAgencyCustomer.vehiclePublicId());
    assertThat(portal.vehicles(principal)).extracting(CustomerPortalService.VehicleView::publicId)
        .doesNotContain(firstAgencyCustomer.vehiclePublicId());
  }


  @Test
  void customerCanMaintainProfilePhotoAndMultipleAddressesWithoutChangingPurchaseHistory() {
    Fixture fixture = createFixture("PROFILE");
    var invitation = portal.issueInvitation(fixture.owner(), fixture.customerPublicId());
    var session = portal.activate(
        new CustomerPortalService.ActivationRequest(invitation.activationToken(), "Strong-Customer-Password-123"),
        "203.0.113.40", "portal-profile-test");
    CustomerPrincipal principal = principalForToken(session.accessToken());

    var updatedProfile = portal.updateProfile(principal, new CustomerPortalService.CustomerProfileUpdate(
        "Updated Portal Customer", "919812345678", "919876543210", "customer-profile@example.test", "en"));
    assertThat(updatedProfile.fullName()).isEqualTo("Updated Portal Customer");
    assertThat(updatedProfile.alternatePhone()).isEqualTo("919876543210");

    var home = portal.createAddress(principal, new CustomerPortalService.AddressRequest(
        "HOME", "Updated Portal Customer", "919812345678", "12 Example Street", "Floor 2",
        "Near the post office", "Station Road", "Bettiah", "West Champaran", "Bihar", "845438", "India", true));
    var work = portal.createAddress(principal, new CustomerPortalService.AddressRequest(
        "WORK", "Updated Portal Customer", "919812345678", "Office 4", null, null,
        "Main Market", "Bettiah", "West Champaran", "Bihar", "845438", "India", false));
    assertThat(portal.addresses(principal)).hasSize(2);
    assertThat(portal.addresses(principal)).filteredOn(CustomerPortalService.CustomerAddressView::isDefaultDelivery)
        .extracting(CustomerPortalService.CustomerAddressView::publicId).containsExactly(home.publicId());

    var updatedHome = portal.updateAddress(principal, home.publicId(), new CustomerPortalService.AddressRequest(
        "HOME", "Updated Portal Customer", "919812345678", "99 New Street", null,
        "Opposite the park", "Station Road", "Bettiah", "West Champaran", "Bihar", "845438", "India", true));
    assertThat(updatedHome.addressLine1()).isEqualTo("99 New Street");
    var remaining = portal.deleteAddress(principal, work.publicId());
    assertThat(remaining).hasSize(1);
    assertThat(remaining.getFirst().isDefaultDelivery()).isTrue();

    byte[] tinyJpegHeader = new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    var uploaded = portal.uploadProfilePhoto(principal,
        new MockMultipartFile("file", "profile.jpg", "image/jpeg", tinyJpegHeader));
    assertThat(uploaded.contentType()).isEqualTo("image/jpeg");
    assertThat(portal.profile(principal).profilePhotoAvailable()).isTrue();
    assertThat(portal.readProfilePhoto(principal).bytes()).containsExactly(tinyJpegHeader);
    assertThat(portal.addressesForStaff(fixture.owner(), fixture.customerPublicId()))
        .extracting(CustomerPortalService.CustomerAddressView::publicId)
        .containsExactly(home.publicId());
    assertThat(portal.readProfilePhotoForStaff(fixture.owner(), fixture.customerPublicId()).bytes())
        .containsExactly(tinyJpegHeader);
    Fixture otherDealership = createFixture("OTHERPROFILE");
    assertThatThrownBy(() -> portal.addressesForStaff(otherDealership.owner(), fixture.customerPublicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
    assertThat(portal.motorcyclePurchases(principal)).isEmpty();

    portal.deleteProfilePhoto(principal);
    assertThat(portal.profile(principal).profilePhotoAvailable()).isFalse();
    assertThatThrownBy(() -> portal.readProfilePhoto(principal))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private CustomerPrincipal principalForToken(String rawToken) {
    return jdbc.queryForObject("""
        select session.id as session_id, account.id as account_id, account.public_id as account_public_id,
          customer.id as customer_id, customer.public_id as customer_public_id,
          dealership.id as dealership_id, dealership.public_id as dealership_public_id,
          dealership.code as dealership_code, dealership.name as dealership_name,
          customer.customer_code, customer.full_name, customer.preferred_language, customer.phone, customer.email
        from customer_portal_session session
        join customer_portal_account account
          on account.dealership_id = session.dealership_id and account.id = session.account_id
        join customer on customer.dealership_id = account.dealership_id and customer.id = account.customer_id
        join dealership on dealership.id = session.dealership_id
        where session.token_hash = ?
        """, (rs, rowNum) -> new CustomerPrincipal(
            rs.getLong("session_id"), rs.getLong("account_id"), rs.getString("account_public_id"),
            rs.getLong("customer_id"), rs.getString("customer_public_id"), rs.getLong("dealership_id"),
            rs.getString("dealership_public_id"), rs.getString("dealership_code"), rs.getString("dealership_name"),
            rs.getString("customer_code"), rs.getString("full_name"), rs.getString("preferred_language"),
            rs.getString("phone"), rs.getString("email")), TokenDigests.sha256(rawToken));
  }

  private Fixture createFixture(String suffix) {
    StaffPrincipal owner = createOwner(suffix);
    CustomerService.CustomerView customer = customers.create(owner,
        new CustomerService.CustomerRequest(
            "Portal Test Customer " + suffix, "9198" + String.format("%06d", Math.abs(UUID.randomUUID().hashCode()) % 1_000_000),
            null, null, "en", false, null, "Created for customer portal integration test."));
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    Long modelId = jdbc.queryForObject("""
        insert into vehicle_model(dealership_id, model_code, model_name, variant_name, colour_name, model_year)
        values (?, ?, 'Portal Test Motorcycle', 'Standard', 'Blue', 2026) returning id
        """, Long.class, owner.dealershipId(), "PORTAL-" + unique);
    UUID vehiclePublicId = jdbc.queryForObject("""
        insert into vehicle_unit(dealership_id, vehicle_model_id, chassis_number, engine_number, stock_status)
        values (?, ?, ?, ?, 'SOLD') returning public_id
        """, UUID.class, owner.dealershipId(), modelId, "CHASSIS-" + unique, "ENGINE-" + unique);
    Long vehicleId = jdbc.queryForObject("""
        select id from vehicle_unit where dealership_id = ? and public_id = ?
        """, Long.class, owner.dealershipId(), vehiclePublicId);
    Long customerId = jdbc.queryForObject("""
        select id from customer where dealership_id = ? and public_id = ?
        """, Long.class, owner.dealershipId(), customer.publicId());
    jdbc.update("""
        insert into customer_vehicle(dealership_id, customer_id, vehicle_unit_id, linked_by_staff_user_id)
        values (?, ?, ?, ?)
        """, owner.dealershipId(), customerId, vehicleId, owner.staffUserId());
    return new Fixture(owner, owner.dealershipCode(), customer.publicId(), customer.customerCode(), vehiclePublicId);
  }

  private StaffPrincipal createOwner(String suffix) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "PORT-" + suffix + "-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Portal Test Agency " + suffix);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Portal Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "portal-owner-" + unique.toLowerCase() + "@example.test");
    Long roleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, roleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?", UUID.class, dealershipId, staffId);
    return new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        code, "Portal Test Owner", Set.of("OWNER"),
        Set.of("customer.read", "customer.create", "customer.update"));
  }

  private record Fixture(
      StaffPrincipal owner, String dealershipCode, UUID customerPublicId,
      String customerCode, UUID vehiclePublicId) {}
}
