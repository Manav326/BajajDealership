package com.quantaedge.bajaj.customers;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
class CustomerPortalControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void privateCustomerEndpointsRequireAnAuthenticatedPortalSession() throws Exception {
    mvc.perform(get("/api/v1/customer/auth/me"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/customer/vehicles"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/customer/service-history"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/customer/addresses"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/customer/purchase-history/motorcycles"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/customer/profile/photo"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void staffCustomerReadPermissionDoesNotGrantCustomerPortalAccess() throws Exception {
    mvc.perform(get("/api/v1/customer/vehicles")
            .with(user("staff-reader")
                .authorities(new SimpleGrantedAuthority("customer.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void customerPortalAuthorityDoesNotGrantStaffCrmAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/customers")
            .with(user("customer-account")
                .authorities(new SimpleGrantedAuthority("customer.portal"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void customerCannotSubmitAppointmentWithoutAuthenticatedPortalSession() throws Exception {
    mvc.perform(post("/api/v1/customer/appointments")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "vehiclePublicId":"00000000-0000-0000-0000-000000000001",
                  "scheduledFor":"2030-01-01T10:00:00Z",
                  "slotMinutes":60,
                  "customerConcern":"Scheduled without a customer session",
                  "customerLanguage":"en"
                }
                """))
        .andExpect(status().isUnauthorized());
  }
}
