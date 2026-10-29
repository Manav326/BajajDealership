package com.quantaedge.bajaj.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class BajajMotorcycleImageServiceIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private BajajMotorcycleImageService images;

  @Test
  void imageUploadSetsPrimaryServesOnlyPublishedModelAndAuditsChanges() {
    StaffPrincipal staff = createCatalogueManager();
    byte[] png = Base64.getDecoder().decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8e0AAAAASUVORK5CYII=");

    var first = images.upload(staff, "BAJAJ_PULSAR_NS200",
        new MockMultipartFile("file", "first.png", "image/png", png));
    assertThat(first.primary()).isTrue();
    var publicFirst = images.readPublic(staff.dealershipCode(), "BAJAJ_PULSAR_NS200", first.publicId());
    assertThat(publicFirst.contentType()).isEqualTo("image/png");
    assertThat(publicFirst.bytes()).containsExactly(png);

    var second = images.upload(staff, "BAJAJ_PULSAR_NS200",
        new MockMultipartFile("file", "second.png", "image/png", png));
    assertThat(second.primary()).isTrue();
    var gallery = images.list(staff, "BAJAJ_PULSAR_NS200");
    assertThat(gallery).hasSize(2);
    assertThat(gallery.getFirst().publicId()).isEqualTo(second.publicId());
    assertThat(gallery.getFirst().primary()).isTrue();
    assertThat(gallery.get(1).primary()).isFalse();

    images.delete(staff, "BAJAJ_PULSAR_NS200", second.publicId());
    var afterDelete = images.list(staff, "BAJAJ_PULSAR_NS200");
    assertThat(afterDelete).hasSize(1);
    assertThat(afterDelete.getFirst().publicId()).isEqualTo(first.publicId());
    assertThat(afterDelete.getFirst().primary()).isTrue();

    assertThatThrownBy(() -> images.readPublic(
        staff.dealershipCode(), "BAJAJ_PULSAR_NS200", second.publicId()))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.NOT_FOUND));

    var actions = jdbc.queryForList("""
        select action from audit_event
        where dealership_id = ? and entity_type = 'BAJAJ_CATALOGUE_IMAGE'
        order by id
        """, String.class, staff.dealershipId());
    assertThat(actions).containsExactly(
        "BAJAJ_CATALOGUE_IMAGE_UPLOADED",
        "BAJAJ_CATALOGUE_IMAGE_UPLOADED",
        "BAJAJ_CATALOGUE_IMAGE_REMOVED");
  }

  @Test
  void rejectsUnsupportedImageBytesAndDoesNotInsertGalleryRecord() {
    StaffPrincipal staff = createCatalogueManager();
    assertThatThrownBy(() -> images.upload(staff, "BAJAJ_PULSAR_NS200",
        new MockMultipartFile("file", "not-an-image.png", "image/png", new byte[] {1,2,3,4,5,6,7,8,9,10,11,12})))
        .isInstanceOf(ResponseStatusException.class)
        .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST));
    assertThat(images.list(staff, "BAJAJ_PULSAR_NS200")).isEmpty();
  }

  private StaffPrincipal createCatalogueManager() {
    String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    String dealershipCode = "IMG-" + suffix;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, dealershipCode, "Catalogue Image Test Dealership");
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Catalogue Image Manager', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "catalogue-image-" + suffix.toLowerCase() + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where id = ?", UUID.class, staffId);
    Long managerRoleId = jdbc.queryForObject("select id from role where code = 'MANAGER'", Long.class);
    jdbc.update("insert into staff_user_role(dealership_id, staff_user_id, role_id) values (?, ?, ?)",
        dealershipId, staffId, managerRoleId);
    jdbc.update("""
        insert into bajaj_catalogue_dealership_model(dealership_id, model_code, is_published)
        values (?, 'BAJAJ_PULSAR_NS200', true)
        """, dealershipId);
    return new StaffPrincipal(1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        dealershipCode, "Catalogue Image Manager", Set.of("MANAGER"),
        Set.of("catalogue.read", "catalogue.manage", "vehicle.read"));
  }
}
