package com.quantaedge.bajaj.customers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
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
class CustomerServiceIntegrationTest {
  @Autowired
  private JdbcTemplate jdbc;

  @Autowired
  private CustomerService customers;

  @Test
  void createsCustomerWithDefaultHindiAndAuditableChange() {
    StaffPrincipal owner = createOwner("A");
    CustomerService.CustomerView created = customers.create(owner,
        new CustomerService.CustomerRequest("Ravi Kumar", "+91 98765 43210", null, null,
            null, false, null, "Bought a commuter bike"));

    assertThat(created.customerCode()).startsWith("CUS-");
    assertThat(created.fullName()).isEqualTo("Ravi Kumar");
    assertThat(created.phone()).isEqualTo("+919876543210");
    assertThat(created.preferredLanguage()).isEqualTo("hi");
    assertThat(created.status()).isEqualTo("ACTIVE");

    Integer auditCount = jdbc.queryForObject("""
        select count(*) from audit_event
        where dealership_id = ? and actor_staff_user_id = ?
          and action = 'CUSTOMER_CREATED' and entity_id = ?
        """, Integer.class, owner.dealershipId(), owner.staffUserId(), created.publicId().toString());
    assertThat(auditCount).isEqualTo(1);

    CustomerService.Page<CustomerService.CustomerView> page = customers.list(owner, 0, 25, "ravi");
    assertThat(page.total()).isEqualTo(1);
    assertThat(page.items()).extracting(CustomerService.CustomerView::publicId)
        .containsExactly(created.publicId());
  }

  @Test
  void customerRecordCannotBeReadAcrossDealershipBoundary() {
    StaffPrincipal agencyA = createOwner("A");
    StaffPrincipal agencyB = createOwner("B");
    CustomerService.CustomerView created = customers.create(agencyA,
        new CustomerService.CustomerRequest("Meera Sharma", "9876543210", null, null,
            "hi", false, null, null));

    assertThatThrownBy(() -> customers.get(agencyB, created.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));

    assertThat(customers.list(agencyB, 0, 25, null).total()).isZero();
  }

  @Test
  void grantingMarketingConsentRequiresARecordedSource() {
    StaffPrincipal owner = createOwner("CONSENT");

    assertThatThrownBy(() -> customers.create(owner,
        new CustomerService.CustomerRequest("Asha Devi", "9876543210", null, null,
            "hi", true, null, null)))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
  }

  @Test
  void updateWithoutConsentFieldPreservesExistingConsent() {
    StaffPrincipal owner = createOwner("PRESERVE");
    CustomerService.CustomerView created = customers.create(owner,
        new CustomerService.CustomerRequest("Rohit Singh", "9876543210", null, null,
            "hi", true, "signed-form", null));

    customers.update(owner, created.publicId(),
        new CustomerService.CustomerRequest("Rohit Singh", "9876543210", null, null,
            "en", null, null, null));

    Boolean consentRemains = jdbc.queryForObject("""
        select marketing_consent_at is not null from customer
        where dealership_id = ? and public_id = ?
        """, Boolean.class, owner.dealershipId(), created.publicId());
    assertThat(consentRemains).isTrue();
  }


  @Test
  void customerHistoryReturnsEveryHistorySectionAndRespectsDealershipBoundary() {
    StaffPrincipal owner = createOwner("HISTORY");
    CustomerService.CustomerView created = customers.create(owner,
        new CustomerService.CustomerRequest("History Customer", "9876500011", null, "history@example.test",
            "en", false, null, "Prefers a call before arranging delivery."));

    CustomerService.CustomerHistoryView history = customers.history(owner, created.publicId());
    assertThat(history.customer().publicId()).isEqualTo(created.publicId());
    assertThat(history.notes()).isEqualTo("Prefers a call before arranging delivery.");
    assertThat(history.motorcyclePurchases()).isEmpty();
    assertThat(history.sparePartOrders()).isEmpty();
    assertThat(history.websiteRequests()).isEmpty();

    StaffPrincipal otherDealership = createOwner("HISTORY_OTHER");
    assertThatThrownBy(() -> customers.history(otherDealership, created.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }


  @Test
  void staffProfileShowsCustomerAddressesAndPrivatePhotoOnlyInsideItsDealership() {
    StaffPrincipal owner = createOwner("PROFILE");
    CustomerService.CustomerView created = customers.create(owner,
        new CustomerService.CustomerRequest("Profile Customer", "9876500099", null, "profile@example.test",
            "en", false, null, null));
    Long customerId = jdbc.queryForObject("""
        select id from customer where dealership_id = ? and public_id = ?
        """, Long.class, owner.dealershipId(), created.publicId());
    jdbc.update("""
        insert into customer_address(dealership_id, customer_id, label, recipient_name, phone,
          address_line1, locality, city, district, state, postal_code, country, is_default_delivery)
        values (?, ?, 'HOME', 'Profile Customer', '9876500099', '12 Sample Road',
          'Station Road', 'Bettiah', 'West Champaran', 'Bihar', '845438', 'India', true)
        """, owner.dealershipId(), customerId);
    byte[] png = java.util.Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwK8AAAAASUVORK5CYII=");
    jdbc.update("""
        insert into customer_profile_photo(dealership_id, customer_id, content_type, image_bytes, byte_length)
        values (?, ?, 'image/png', ?, ?)
        """, owner.dealershipId(), customerId, png, png.length);

    var addresses = customers.savedAddresses(owner, created.publicId());
    assertThat(addresses).hasSize(1);
    assertThat(addresses.getFirst().isDefaultDelivery()).isTrue();
    assertThat(addresses.getFirst().addressLine1()).isEqualTo("12 Sample Road");
    var photo = customers.profilePhoto(owner, created.publicId());
    assertThat(photo.contentType()).isEqualTo("image/png");
    assertThat(photo.bytes()).containsExactly(png);

    StaffPrincipal anotherDealership = createOwner("PROFILE_OTHER");
    assertThatThrownBy(() -> customers.savedAddresses(anotherDealership, created.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
    assertThatThrownBy(() -> customers.profilePhoto(anotherDealership, created.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));
  }

  private StaffPrincipal createOwner(String suffix) {
    String unique = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String code = "TST-" + suffix + "-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Test Agency " + suffix);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, ?, ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "Test Owner", "owner-" + unique.toLowerCase() + "@example.test");
    Long ownerRoleId = jdbc.queryForObject("select id from role where code='OWNER'", Long.class);
    jdbc.update("""
        insert into staff_user_role(dealership_id, staff_user_id, role_id)
        values (?, ?, ?)
        """, dealershipId, staffId, ownerRoleId);
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    return new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        code, "Test Owner", Set.of("OWNER"), Set.of("customer.read", "customer.create", "customer.update"));
  }
}
