package com.quantaedge.bajaj.security;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** Guards the read boundary for the dealership-scoped staff directory. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StaffDirectoryControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void unauthenticatedRequestsCannotReadStaffDirectory() throws Exception {
    UUID staffId = UUID.randomUUID();

    mvc.perform(get("/api/v1/admin/staff"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/admin/staff/{staffPublicId}", staffId))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void unrelatedStaffPermissionCannotReadStaffDirectory() throws Exception {
    UUID staffId = UUID.randomUUID();

    mvc.perform(get("/api/v1/admin/staff")
            .with(user("sales-reader")
                .authorities(new SimpleGrantedAuthority("sales.read"))))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/v1/admin/staff/{staffPublicId}", staffId)
            .with(user("sales-reader")
                .authorities(new SimpleGrantedAuthority("sales.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void staffReadCanListRecordsAndUnknownScopedIdsReturnNotFound() throws Exception {
    UUID unknownStaffId = UUID.randomUUID();

    mvc.perform(get("/api/v1/admin/staff")
            .with(staffReader()))
        .andExpect(status().isOk());

    mvc.perform(get("/api/v1/admin/staff/{staffPublicId}", unknownStaffId)
            .with(staffReader()))
        .andExpect(status().isNotFound());
  }

  private static org.springframework.test.web.servlet.request.RequestPostProcessor staffReader() {
    UUID staffPublicId = UUID.randomUUID();
    UUID dealershipPublicId = UUID.randomUUID();
    StaffPrincipal principal = new StaffPrincipal(
        1L, 1L, staffPublicId.toString(), 1L, dealershipPublicId.toString(),
        "TEST-DEALERSHIP", "Directory reader", Set.of("STAFF_READER"), Set.of("staff.read"));
    return authentication(new UsernamePasswordAuthenticationToken(
        principal, "test-credentials", List.of(new SimpleGrantedAuthority("staff.read"))));
  }
}
