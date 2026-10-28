package com.quantaedge.bajaj.security;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StaffAccessManagementControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void anonymousStaffManagementRequestsRequireAuthentication() throws Exception {
    mvc.perform(get("/api/v1/admin/staff/roles")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/v1/admin/staff/invitations")
            .contentType(MediaType.APPLICATION_JSON)
            .content(invitationBody()))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void readOnlyAndCustomerAuthoritiesCannotManageStaffOrRoles() throws Exception {
    mvc.perform(get("/api/v1/admin/staff/roles")
            .with(user("staff-reader").authorities(new SimpleGrantedAuthority("staff.read"))))
        .andExpect(status().isForbidden());

    mvc.perform(post("/api/v1/admin/staff/invitations")
            .with(user("staff-reader").authorities(new SimpleGrantedAuthority("staff.read")))
            .contentType(MediaType.APPLICATION_JSON).content(invitationBody()))
        .andExpect(status().isForbidden());

    UUID target = UUID.randomUUID();
    mvc.perform(put("/api/v1/admin/staff/{id}/roles", target)
            .with(user("customer").authorities(new SimpleGrantedAuthority("customer.portal")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"roleCodes\":[\"SALES_EXECUTIVE\"],\"reason\":\"Authorization test\"}"))
        .andExpect(status().isForbidden());

    mvc.perform(put("/api/v1/admin/staff/{id}/status", target)
            .with(user("staff-reader").authorities(new SimpleGrantedAuthority("staff.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"status\":\"DISABLED\",\"reason\":\"Authorization test\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void staffReadDoesNotGrantInvitationActivationAdministration() throws Exception {
    mvc.perform(get("/api/v1/admin/staff/roles")
            .with(user("sales-reader").authorities(new SimpleGrantedAuthority("sales.read"))))
        .andExpect(status().isForbidden());
  }

  private static String invitationBody() {
    return """
        {
          "fullName":"Test invite",
          "email":"invite@example.test",
          "phone":null,
          "roleCodes":["SALES_EXECUTIVE"],
          "reason":"New staff member"
        }
        """;
  }
}
