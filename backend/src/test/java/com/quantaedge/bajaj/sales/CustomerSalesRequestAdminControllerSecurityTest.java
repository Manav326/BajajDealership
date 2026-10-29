package com.quantaedge.bajaj.sales;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/** HTTP permission boundary for the public-showroom request queue and its conversion action. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomerSalesRequestAdminControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void listingAndConversionRequireAuthenticatedStaff() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/customer-requests"))
        .andExpect(status().isUnauthorized());
    mvc.perform(post("/api/v1/admin/sales/customer-requests/{publicId}/convert", UUID.randomUUID()))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void customerPortalAuthorityCannotReadOrConvertStaffWebsiteRequests() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/customer-requests")
            .with(user("customer-account")
                .authorities(new SimpleGrantedAuthority("customer.portal"))))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/admin/sales/customer-requests/{publicId}/convert", UUID.randomUUID())
            .with(user("customer-account")
                .authorities(new SimpleGrantedAuthority("customer.portal"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void salesReadCanListButCannotConvertAWebsiteRequest() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/customer-requests/{publicId}/convert", UUID.randomUUID())
            .with(user("sales-reader")
                .authorities(new SimpleGrantedAuthority("sales.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void salesManageAloneDoesNotGrantWebsiteRequestListAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/customer-requests")
            .with(user("sales-manager")
                .authorities(new SimpleGrantedAuthority("sales.manage"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void financePermissionDoesNotGrantWebsiteRequestAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/customer-requests")
            .with(user("finance-reader")
                .authorities(new SimpleGrantedAuthority("finance.read"))))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/v1/admin/sales/customer-requests/{publicId}/convert", UUID.randomUUID())
            .with(user("finance-manager")
                .authorities(new SimpleGrantedAuthority("finance.invoice"))))
        .andExpect(status().isForbidden());
  }
}
