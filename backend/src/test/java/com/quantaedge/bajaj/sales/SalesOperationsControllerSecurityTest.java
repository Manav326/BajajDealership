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
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SalesOperationsControllerSecurityTest {
  @Autowired private MockMvc mvc;

  @Test
  void salesRoutesRequireAuthenticatedStaff() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/enquiries"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void customerReadDoesNotGrantSalesPipelineAccess() throws Exception {
    mvc.perform(get("/api/v1/admin/sales/enquiries")
            .with(user("customer-reader").authorities(new SimpleGrantedAuthority("customer.read"))))
        .andExpect(status().isForbidden());
  }

  @Test
  void salesReadDoesNotGrantEnquiryMutation() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/enquiries/{publicId}/status", UUID.randomUUID())
            .with(user("sales-reader").authorities(new SimpleGrantedAuthority("sales.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"status":"CONTACTED","note":"Permission check"}
                """))
        .andExpect(status().isForbidden());
  }

  @Test
  void salesReadDoesNotGrantBookingCreation() throws Exception {
    mvc.perform(post("/api/v1/admin/sales/enquiries/{publicId}/bookings", UUID.randomUUID())
            .with(user("sales-reader").authorities(new SimpleGrantedAuthority("sales.read")))
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"vehicleUnitPublicId":"%s","notes":"Permission check"}
                """.formatted(UUID.randomUUID())))
        .andExpect(status().isForbidden());
  }
}
