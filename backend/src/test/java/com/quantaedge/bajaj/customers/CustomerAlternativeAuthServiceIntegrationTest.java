package com.quantaedge.bajaj.customers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.CustomerPortalAttemptRecorder;
import com.quantaedge.bajaj.security.StaffPrincipal;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class CustomerAlternativeAuthServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private CustomerService customers;
  @Autowired private CustomerPortalService portal;
  @Autowired private CustomerAlternativeAuthService authentication;

  @Test
  void usernameActivationLoginAndPasswordResetPreserveInvitationRules() {
    Fixture fixture = createFixture("USERNAME", null);
    var invitation = portal.issueInvitation(fixture.owner(), fixture.customerPublicId());

    var activated = authentication.activateWithUsername(
        invitation.activationToken(), "Rider.User", "Strong-Customer-Password-123",
        "203.0.113.81", "customer-auth-test");
    assertThat(activated.customer().publicId()).isEqualTo(fixture.customerPublicId());

    String storedUsername = jdbc.queryForObject(
        "select username from customer_portal_account where dealership_id = ? and customer_id = "
            + "(select id from customer where dealership_id = ? and public_id = ?)",
        String.class, fixture.dealershipId(), fixture.dealershipId(), fixture.customerPublicId());
    assertThat(storedUsername).isEqualTo("rider.user");

    var signedIn = authentication.loginWithUsername(
        fixture.dealershipCode(), "RIDER.USER", "Strong-Customer-Password-123",
        "203.0.113.82", "customer-auth-test");
    assertThat(signedIn.customer().publicId()).isEqualTo(fixture.customerPublicId());

    var resetInvitation = portal.issueInvitation(fixture.owner(), fixture.customerPublicId());
    assertThat(resetInvitation.purpose()).isEqualTo("PASSWORD_RESET");
    var resetSession = authentication.activateWithUsername(
        resetInvitation.activationToken(), "Rider.User", "New-Customer-Password-789",
        "203.0.113.83", "customer-auth-test");
    assertThat(resetSession.customer().publicId()).isEqualTo(fixture.customerPublicId());

    assertThatThrownBy(() -> authentication.loginWithUsername(
        fixture.dealershipCode(), "rider.user", "Strong-Customer-Password-123",
        "203.0.113.84", "customer-auth-test"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED));

    var afterReset = authentication.loginWithUsername(
        fixture.dealershipCode(), "rider.user", "New-Customer-Password-789",
        "203.0.113.85", "customer-auth-test");
    assertThat(afterReset.customer().publicId()).isEqualTo(fixture.customerPublicId());
  }

  @Test
  void verifiedGoogleIdentityCanSignInOnlyToItsMatchedCustomerAndCannotBeClaimedTwice() {
    String email = "google-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
    Fixture fixture = createFixture("GOOGLE", email);
    var identity = new CustomerGoogleIdentityService.VerifiedIdentity(
        "google-subject-" + UUID.randomUUID(), email, "Google Rider", null);

    var first = authentication.loginWithGoogle(
        fixture.dealershipCode(), identity, "203.0.113.86", "customer-auth-test");
    assertThat(first.customer().publicId()).isEqualTo(fixture.customerPublicId());

    var repeat = authentication.loginWithGoogle(
        fixture.dealershipCode(), identity, "203.0.113.87", "customer-auth-test");
    assertThat(repeat.customer().publicId()).isEqualTo(fixture.customerPublicId());

    var differentSubject = new CustomerGoogleIdentityService.VerifiedIdentity(
        "different-google-subject-" + UUID.randomUUID(), email, "Another Rider", null);
    assertThatThrownBy(() -> authentication.loginWithGoogle(
        fixture.dealershipCode(), differentSubject, "203.0.113.88", "customer-auth-test"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED));
  }

  @Test
  void unmatchedGoogleEmailDoesNotCreateACustomerPortalAccount() {
    Fixture fixture = createFixture("NOMATCH", null);
    var identity = new CustomerGoogleIdentityService.VerifiedIdentity(
        "google-subject-" + UUID.randomUUID(),
        "unmatched-" + UUID.randomUUID() + "@example.test", "Unmatched Rider", null);

    assertThatThrownBy(() -> authentication.loginWithGoogle(
        fixture.dealershipCode(), identity, "203.0.113.89", "customer-auth-test"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED));

    Integer accounts = jdbc.queryForObject(
        "select count(*) from customer_portal_account where dealership_id = ?",
        Integer.class, fixture.dealershipId());
    assertThat(accounts).isZero();
  }

  @Test
  void disabledGoogleLinkedAccountCannotStartAnotherSession() {
    String email = "disabled-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
    Fixture fixture = createFixture("DISABLED", email);
    var identity = new CustomerGoogleIdentityService.VerifiedIdentity(
        "google-subject-" + UUID.randomUUID(), email, "Google Rider", null);
    authentication.loginWithGoogle(
        fixture.dealershipCode(), identity, "203.0.113.90", "customer-auth-test");

    jdbc.update(
        "update customer_portal_account set status = 'DISABLED' where dealership_id = ? and customer_id = "
            + "(select id from customer where dealership_id = ? and public_id = ?)",
        fixture.dealershipId(), fixture.dealershipId(), fixture.customerPublicId());

    assertThatThrownBy(() -> authentication.loginWithGoogle(
        fixture.dealershipCode(), identity, "203.0.113.91", "customer-auth-test"))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED));
  }

  private Fixture createFixture(String suffix, String email) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String dealershipCode = "ALT-" + suffix + "-" + unique;
    Long dealershipId = jdbc.queryForObject(
        "insert into dealership(code, name) values (?, ?) returning id",
        Long.class, dealershipCode, "Alternative Auth Test " + suffix);
    Long staffId = jdbc.queryForObject(
        "insert into staff_user(dealership_id, full_name, email, password_hash, status) "
            + "values (?, 'Portal Test Owner', ?, 'test-hash-not-used', 'ACTIVE') returning id",
        Long.class, dealershipId, "owner-" + unique.toLowerCase() + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?",
        UUID.class, dealershipId, staffId);
    StaffPrincipal owner = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Portal Test Owner", Set.of("OWNER"),
        Set.of("customer.read", "customer.create", "customer.update"));

    String phone = "9198" + String.format("%06d", Math.floorMod(UUID.randomUUID().hashCode(), 1_000_000));
    CustomerService.CustomerView customer = customers.create(owner,
        new CustomerService.CustomerRequest(
            "Alternative Auth Customer " + suffix, phone, null, email, "en", false, null,
            "Created for alternative authentication integration tests."));
    return new Fixture(owner, dealershipId, dealershipCode, customer.publicId());
  }

  private record Fixture(
      StaffPrincipal owner, long dealershipId, String dealershipCode, UUID customerPublicId) {}
}
