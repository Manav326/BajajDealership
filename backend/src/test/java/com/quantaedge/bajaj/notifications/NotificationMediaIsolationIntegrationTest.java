package com.quantaedge.bajaj.notifications;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.quantaedge.bajaj.security.StaffPrincipal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class NotificationMediaIsolationIntegrationTest {
  @Autowired private JdbcTemplate jdbc;
  @Autowired private MockMvc mvc;

  @Test
  void staffWithMediaReadPermissionCannotReadAnotherDealershipsPrivateAsset() throws Exception {
    Fixture actor = createFixture("ACTOR");
    Fixture assetOwner = createFixture("FOREIGN");
    UUID assetPublicId = UUID.randomUUID();

    jdbc.update("""
        insert into notification_media_asset(
          public_id, dealership_id, created_by_staff_user_id, asset_kind, mime_type,
          byte_length, sha256, width, height, storage_key, alt_text, decorative, status)
        values (?, ?, ?, 'IMAGE', 'image/png', 4, repeat('a', 64), 1, 1, ?, 'Fixture image', false, 'ACTIVE')
        """,
        assetPublicId,
        assetOwner.dealershipId(),
        assetOwner.staffUserId(),
        assetOwner.dealershipId() + "/" + assetPublicId + ".png");

    var authentication = new UsernamePasswordAuthenticationToken(
        actor.principal(),
        "unused-test-credential",
        List.of(new SimpleGrantedAuthority("notification.read")));

    mvc.perform(get("/api/v1/admin/notifications/media/{assetId}", assetPublicId)
            .with(authentication(authentication)))
        .andExpect(status().isNotFound());
  }

  private Fixture createFixture(String label) {
    String unique = UUID.randomUUID().toString().replace("-", "").substring(0, 10).toUpperCase();
    String code = "MEDIA-" + label + "-" + unique;
    Long dealershipId = jdbc.queryForObject("""
        insert into dealership(code, name) values (?, ?) returning id
        """, Long.class, code, "Media isolation " + label);
    Long staffId = jdbc.queryForObject("""
        insert into staff_user(dealership_id, full_name, email, password_hash, status)
        values (?, 'Media Test Staff', ?, 'test-hash-not-used', 'ACTIVE') returning id
        """, Long.class, dealershipId, "media-" + label.toLowerCase() + "-" + unique + "@example.test");
    UUID dealershipPublicId = jdbc.queryForObject(
        "select public_id from dealership where id = ?", UUID.class, dealershipId);
    UUID staffPublicId = jdbc.queryForObject(
        "select public_id from staff_user where dealership_id = ? and id = ?",
        UUID.class, dealershipId, staffId);

    StaffPrincipal principal = new StaffPrincipal(
        1, staffId, staffPublicId.toString(), dealershipId, dealershipPublicId.toString(),
        code, "Media Test Staff", Set.of("OWNER"), Set.of("notification.read"));
    return new Fixture(dealershipId, staffId, principal);
  }

  private record Fixture(long dealershipId, long staffUserId, StaffPrincipal principal) {}
}
